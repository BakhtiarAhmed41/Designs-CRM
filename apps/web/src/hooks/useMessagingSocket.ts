import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { apiOrigin } from '@/lib/api';
import { invalidateWorkCaches } from '@/lib/queryCache';
import { getAccessToken } from '@/lib/session';

type Handler = (payload: unknown) => void;

let shared: Socket | null = null;

function getSocket() {
  if (shared) return shared;
  const origin = apiOrigin() || window.location.origin;
  shared = io(`${origin}/messaging`, {
    withCredentials: true,
    transports: ['websocket', 'polling'],
    autoConnect: false,
    auth: (cb) => cb({ token: getAccessToken() || '' }),
  });
  return shared;
}

export function useMessagingSocket(handlers: {
  onMessageNew?: Handler;
  onConversationUpdated?: Handler;
  onUnreadChanged?: Handler;
  onTeamMessage?: Handler;
  onPresenceUpdate?: Handler;
  onNotificationNew?: Handler;
  conversationId?: string | null;
  peerId?: string | null;
}) {
  const qc = useQueryClient();
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const socket = getSocket();
    if (!socket.connected) socket.connect();

    const onMessageNew = (payload: unknown) => {
      handlersRef.current.onMessageNew?.(payload);
      void qc.invalidateQueries({ queryKey: ['admin-conversations'] });
      void qc.invalidateQueries({ queryKey: ['admin-conversations-preview'] });
      void qc.invalidateQueries({ queryKey: ['admin-conversations-order'] });
      void qc.invalidateQueries({ queryKey: ['admin-conversations-quote'] });
      void qc.invalidateQueries({ queryKey: ['my-conversations'] });
      void qc.invalidateQueries({ queryKey: ['admin-unread-messages'] });
      void qc.invalidateQueries({ queryKey: ['portal-unread'] });
    };
    const onConversationUpdated = (payload: unknown) => {
      handlersRef.current.onConversationUpdated?.(payload);
      void qc.invalidateQueries({ queryKey: ['admin-conversations'] });
      void qc.invalidateQueries({ queryKey: ['admin-conversations-preview'] });
      void qc.invalidateQueries({ queryKey: ['admin-conversations-order'] });
      void qc.invalidateQueries({ queryKey: ['admin-conversations-quote'] });
      void qc.invalidateQueries({ queryKey: ['my-conversations'] });
    };
    const onUnreadChanged = (payload: unknown) => {
      handlersRef.current.onUnreadChanged?.(payload);
      void qc.invalidateQueries({ queryKey: ['admin-unread-messages'] });
      void qc.invalidateQueries({ queryKey: ['team-unread'] });
      void qc.invalidateQueries({ queryKey: ['portal-unread'] });
    };
    const onTeamMessage = (payload: unknown) => {
      handlersRef.current.onTeamMessage?.(payload);
      void qc.invalidateQueries({ queryKey: ['team-chat'] });
      void qc.invalidateQueries({ queryKey: ['group-chat'] });
      void qc.invalidateQueries({ queryKey: ['team-unread'] });
      void qc.invalidateQueries({ queryKey: ['team-recent'] });
    };
    const onNotificationNew = (payload: unknown) => {
      handlersRef.current.onNotificationNew?.(payload);
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void invalidateWorkCaches(qc);
    };
    const onPresenceUpdate = (payload: unknown) => {
      handlersRef.current.onPresenceUpdate?.(payload);
      const p = payload as { userId?: string; presence?: string };
      if (p?.userId && p.presence) {
        qc.setQueryData(['admin-team'], (prev: unknown) => {
          if (!prev || typeof prev !== 'object') return prev;
          const data = prev as { members?: Array<{ id: string; presence: string }> };
          if (!Array.isArray(data.members)) return prev;
          return {
            ...data,
            members: data.members.map((m) =>
              m.id === p.userId ? { ...m, presence: p.presence as string } : m,
            ),
          };
        });
      }
      // Presence is already patched into the team cache above.
    };

    socket.on('message:new', onMessageNew);
    socket.on('conversation:updated', onConversationUpdated);
    socket.on('unread:changed', onUnreadChanged);
    socket.on('team:message', onTeamMessage);
    socket.on('notification:new', onNotificationNew);
    socket.on('presence:update', onPresenceUpdate);

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && socket.connected) {
        socket.emit('presence:online');
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      socket.off('message:new', onMessageNew);
      socket.off('conversation:updated', onConversationUpdated);
      socket.off('unread:changed', onUnreadChanged);
      socket.off('team:message', onTeamMessage);
      socket.off('notification:new', onNotificationNew);
      socket.off('presence:update', onPresenceUpdate);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [qc]);

  useEffect(() => {
    const socket = getSocket();
    const id = handlers.conversationId;
    if (!id) return;
    socket.emit('join:conversation', { conversationId: id });
    return () => {
      socket.emit('leave:conversation', { conversationId: id });
    };
  }, [handlers.conversationId]);

  useEffect(() => {
    const socket = getSocket();
    const peerId = handlers.peerId;
    if (!peerId) return;
    socket.emit('join:team-dm', { peerId });
  }, [handlers.peerId]);
}

export function maybeRequestBrowserNotifications() {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'default') {
    void Notification.requestPermission();
  }
}

export function showBrowserNotification(title: string, body?: string) {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible') return;
  try {
    new Notification(title, { body, icon: '/favicon.ico' });
  } catch {
    /* ignore */
  }
}
