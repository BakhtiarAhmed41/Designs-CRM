import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageComposer } from '@/components/messaging/MessageComposer';
import { useAuth } from '@/context/AuthContext';
import { getErrorMessage, resolveFileUrl } from '@/lib/api';
import { canFeature } from '@/lib/permissions';
import {
  getRecentTeamChats,
  getTeamChat,
  getTeamUnreadSummary,
  listGroupChat,
  listTeam,
  sendGroupChat,
  sendTeamChat,
  type Presence,
  type TeamChatMessage,
  type GroupChatMessage,
} from '@/lib/team';
import {
  maybeRequestBrowserNotifications,
  showBrowserNotification,
  useMessagingSocket,
} from '@/hooks/useMessagingSocket';

function memberLabel(m: { firstName: string | null; lastName: string | null; email: string }) {
  return [m.firstName, m.lastName].filter(Boolean).join(' ') || m.email.split('@')[0];
}

function presenceColor(p: Presence) {
  if (p === 'ON') return 'var(--green)';
  if (p === 'AWAY') return 'var(--amber)';
  return '#c3c9d1';
}

function formatMsgTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function AdminTeamMessages() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const peerId = searchParams.get('peer');
  const groupMode = searchParams.get('group') === '1' || (!peerId && searchParams.get('group') !== '0');
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);

  const canSend =
    canFeature(user?.permissions, 'messages_team_send') ||
    canFeature(user?.permissions, 'messages');
  const canGroup =
    canFeature(user?.permissions, 'messages_group') ||
    canFeature(user?.permissions, 'messages');

  const teamQuery = useQuery({
    queryKey: ['admin-team'],
    queryFn: listTeam,
    refetchInterval: 60_000,
  });
  const unreadQuery = useQuery({
    queryKey: ['team-unread'],
    queryFn: getTeamUnreadSummary,
    refetchInterval: 15_000,
  });
  const recentQuery = useQuery({
    queryKey: ['team-recent'],
    queryFn: getRecentTeamChats,
    refetchInterval: 15_000,
  });

  const members = (teamQuery.data?.members ?? []).filter((m) => m.id !== user?.id);
  const filtered = members.filter((m) => {
    const hay = `${memberLabel(m)} ${m.email}`.toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });

  const activePeerId = groupMode ? null : peerId;
  const dmQuery = useQuery({
    queryKey: ['team-chat', activePeerId],
    queryFn: () => getTeamChat(activePeerId as string),
    enabled: !!activePeerId,
    refetchInterval: 10_000,
  });
  const groupQuery = useQuery({
    queryKey: ['group-chat'],
    queryFn: listGroupChat,
    enabled: groupMode && canGroup,
    refetchInterval: 10_000,
  });

  useMessagingSocket({
    peerId: activePeerId,
    onTeamMessage: () => {
      showBrowserNotification('New team message');
    },
  });

  const sendDm = useMutation({
    mutationFn: ({ body, files }: { body: string; files: File[] }) =>
      sendTeamChat(activePeerId as string, body, files),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['team-chat', activePeerId] });
      void qc.invalidateQueries({ queryKey: ['team-unread'] });
      void qc.invalidateQueries({ queryKey: ['team-recent'] });
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const sendGroup = useMutation({
    mutationFn: ({ body, files }: { body: string; files: File[] }) =>
      sendGroupChat(body, files),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['group-chat'] });
      void qc.invalidateQueries({ queryKey: ['team-unread'] });
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const peer = dmQuery.data?.peer;
  const peerUnread = unreadQuery.data?.peerUnread ?? {};
  const recentIds = useMemo(
    () => new Set((recentQuery.data?.conversations ?? []).map((c) => c.peerId)),
    [recentQuery.data],
  );

  const sharedFiles = useMemo(() => {
    const msgs = groupMode
      ? (groupQuery.data?.messages ?? [])
      : (dmQuery.data?.messages ?? []);
    const files: Array<{ id: string; originalName: string; url: string }> = [];
    for (const m of msgs as Array<TeamChatMessage | GroupChatMessage>) {
      for (const a of m.attachments ?? []) {
        files.push({ id: a.id, originalName: a.originalName, url: a.url });
      }
    }
    return files.slice(-20).reverse();
  }, [dmQuery.data, groupQuery.data, groupMode]);

  function openPeer(id: string) {
    setSearchParams({ peer: id });
    maybeRequestBrowserNotifications();
  }

  function openGroup() {
    setSearchParams({ group: '1' });
    maybeRequestBrowserNotifications();
  }

  return (
    <div className="msg-workspace team">
      <aside className="msg-left">
        <div className="msg-left-head">
          <div className="h2" style={{ margin: 0 }}>Team Messages</div>
          <input
            className="msg-search"
            placeholder="Search team members…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="msg-left-list">
          {canGroup && (
            <button
              type="button"
              className={`msg-cust-card ${groupMode ? 'on' : ''}`}
              onClick={openGroup}
            >
              <div className="av" style={{ background: 'var(--tint)' }}>
                <i className="ti ti-users-group" />
              </div>
              <div className="msg-cust-main">
                <div className="msg-cust-top">
                  <strong>Group Chat</strong>
                  {(unreadQuery.data?.groupUnread ?? 0) > 0 && (
                    <span className="msg-badge">{unreadQuery.data?.groupUnread}</span>
                  )}
                </div>
                <div className="msg-cust-preview">Everyone on the team</div>
              </div>
            </button>
          )}

          <div className="msg-section-label">Recent</div>
          {(recentQuery.data?.conversations ?? []).map((c) => {
            const m = members.find((x) => x.id === c.peerId);
            if (!m) return null;
            return (
              <button
                key={c.peerId}
                type="button"
                className={`msg-cust-card ${!groupMode && peerId === c.peerId ? 'on' : ''}`}
                onClick={() => openPeer(c.peerId)}
              >
                <div className="av" style={{ position: 'relative' }}>
                  {(m.initials || memberLabel(m).slice(0, 2)).toUpperCase()}
                  <span
                    className="tm-dot"
                    style={{
                      position: 'absolute',
                      right: -2,
                      bottom: -2,
                      background: presenceColor(m.presence),
                    }}
                  />
                </div>
                <div className="msg-cust-main">
                  <div className="msg-cust-top">
                    <strong>{memberLabel(m)}</strong>
                    {c.unread > 0 && <span className="msg-badge">{c.unread}</span>}
                  </div>
                  <div className="msg-cust-preview">{c.lastBody}</div>
                </div>
              </button>
            );
          })}

          <div className="msg-section-label">All teammates</div>
          {filtered
            .filter((m) => !recentIds.has(m.id))
            .map((m) => (
              <button
                key={m.id}
                type="button"
                className={`msg-cust-card ${!groupMode && peerId === m.id ? 'on' : ''}`}
                onClick={() => openPeer(m.id)}
              >
                <div className="av" style={{ position: 'relative' }}>
                  {(m.initials || memberLabel(m).slice(0, 2)).toUpperCase()}
                  <span
                    className="tm-dot"
                    style={{
                      position: 'absolute',
                      right: -2,
                      bottom: -2,
                      background: presenceColor(m.presence),
                    }}
                  />
                </div>
                <div className="msg-cust-main">
                  <div className="msg-cust-top">
                    <strong>{memberLabel(m)}</strong>
                    {(peerUnread[m.id] ?? 0) > 0 && (
                      <span className="msg-badge">{peerUnread[m.id]}</span>
                    )}
                  </div>
                  <div className="msg-cust-preview">{m.role.replace('_', ' ')}</div>
                </div>
              </button>
            ))}
        </div>
      </aside>

      <section className="msg-center">
        {groupMode && canGroup ? (
          <>
            <div className="msg-center-head">
              <div>
                <div className="h2" style={{ margin: 0 }}>Group Chat</div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  All CRM users · real-time
                </div>
              </div>
            </div>
            <div className="msg-thread">
              {(groupQuery.data?.messages ?? []).map((m) => (
                <div
                  key={m.id}
                  className={`msg-bubble ${m.senderUserId === user?.id ? 'mine' : 'theirs'}`}
                >
                  <div className="msg-bubble-body">
                    {m.senderUserId !== user?.id && (
                      <div className="msg-sender">{m.senderName}</div>
                    )}
                    {m.body}
                    {(m.attachments ?? []).map((a) => (
                      <a
                        key={a.id}
                        className="msg-file"
                        href={resolveFileUrl(a.url)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <i className="ti ti-file" /> {a.originalName}
                      </a>
                    ))}
                  </div>
                  <div className="msg-meta">{formatMsgTime(m.createdAt)}</div>
                </div>
              ))}
            </div>
            {error && <div className="err" style={{ margin: '0 12px' }}>{error}</div>}
            <MessageComposer
              disabled={!canSend}
              onSend={async (body, files) => {
                await sendGroup.mutateAsync({ body, files });
              }}
            />
          </>
        ) : activePeerId && peer ? (
          <>
            <div className="msg-center-head">
              <div>
                <div className="h2" style={{ margin: 0 }}>{memberLabel(peer)}</div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  {peer.role.replace('_', ' ')} · {peer.presence === 'ON' ? 'Online' : peer.presence === 'AWAY' ? 'Away' : 'Offline'}
                </div>
              </div>
            </div>
            <div className="msg-thread">
              {(dmQuery.data?.messages ?? []).map((m) => (
                <div key={m.id} className={`msg-bubble ${m.mine ? 'mine' : 'theirs'}`}>
                  <div className="msg-bubble-body">
                    {m.body}
                    {(m.attachments ?? []).map((a) => (
                      <a
                        key={a.id}
                        className="msg-file"
                        href={resolveFileUrl(a.url)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <i className="ti ti-file" /> {a.originalName}
                      </a>
                    ))}
                  </div>
                  <div className="msg-meta">{formatMsgTime(m.createdAt)}</div>
                </div>
              ))}
            </div>
            {error && <div className="err" style={{ margin: '0 12px' }}>{error}</div>}
            <MessageComposer
              disabled={!canSend}
              onSend={async (body, files) => {
                await sendDm.mutateAsync({ body, files });
              }}
            />
          </>
        ) : (
          <div className="msg-empty-state">
            Select a teammate or open the group chat.
          </div>
        )}
      </section>

      <aside className="msg-right">
        {groupMode ? (
          <div className="msg-right-section">
            <div className="msg-right-title">Group info</div>
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              Global channel for the whole CRM team. Owner/Admin are included by default.
            </p>
          </div>
        ) : peer ? (
          <div className="msg-right-section">
            <div className="msg-right-title">Profile</div>
            <div className="msg-kv"><span>Name</span><b>{memberLabel(peer)}</b></div>
            <div className="msg-kv"><span>Email</span><b>{peer.email}</b></div>
            <div className="msg-kv"><span>Role</span><b>{peer.role}</b></div>
            <div className="msg-kv"><span>Status</span><b>{peer.presence}</b></div>
          </div>
        ) : (
          <div className="msg-empty">Conversation details</div>
        )}
        <div className="msg-right-section">
          <div className="msg-right-title">Shared files</div>
          {sharedFiles.map((f) => (
            <a
              key={f.id}
              href={resolveFileUrl(f.url)}
              target="_blank"
              rel="noreferrer"
              className="msg-side-row"
            >
              <b><i className="ti ti-file" /> {f.originalName}</b>
            </a>
          ))}
          {sharedFiles.length === 0 && <div className="muted">No files yet</div>}
        </div>
      </aside>
    </div>
  );
}
