import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { apiOrigin } from '@/lib/api';

type Handler = (payload: unknown) => void;

let shared: Socket | null = null;

function getSocket() {
  if (shared) return shared;
  const origin = apiOrigin() || window.location.origin;
  shared = io(`${origin}/messaging`, {
    withCredentials: true,
    transports: ['websocket', 'polling'],
    autoConnect: false,
  });
  return shared;
}

export function useMessagingSocket(handlers: {
  onMessageNew?: Handler;
  onConversationUpdated?: Handler;
  onUnreadChanged?: Handler;
  onTeamMessage?: Handler;
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
      void qc.invalidateQueries({ queryKey: ['my-conversations'] });
      void qc.invalidateQueries({ queryKey: ['admin-unread-messages'] });
      void qc.invalidateQueries({ queryKey: ['portal-convos-nav'] });
    };
    const onConversationUpdated = (payload: unknown) => {
      handlersRef.current.onConversationUpdated?.(payload);
      void qc.invalidateQueries({ queryKey: ['admin-conversations'] });
      void qc.invalidateQueries({ queryKey: ['my-conversations'] });
    };
    const onUnreadChanged = (payload: unknown) => {
      handlersRef.current.onUnreadChanged?.(payload);
      void qc.invalidateQueries({ queryKey: ['admin-unread-messages'] });
      void qc.invalidateQueries({ queryKey: ['team-unread'] });
      void qc.invalidateQueries({ queryKey: ['portal-convos-nav'] });
    };
    const onTeamMessage = (payload: unknown) => {
      handlersRef.current.onTeamMessage?.(payload);
      void qc.invalidateQueries({ queryKey: ['team-chat'] });
      void qc.invalidateQueries({ queryKey: ['group-chat'] });
      void qc.invalidateQueries({ queryKey: ['team-unread'] });
      void qc.invalidateQueries({ queryKey: ['team-recent'] });
    };

    socket.on('message:new', onMessageNew);
    socket.on('conversation:updated', onConversationUpdated);
    socket.on('unread:changed', onUnreadChanged);
    socket.on('team:message', onTeamMessage);

    return () => {
      socket.off('message:new', onMessageNew);
      socket.off('conversation:updated', onConversationUpdated);
      socket.off('unread:changed', onUnreadChanged);
      socket.off('team:message', onTeamMessage);
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
