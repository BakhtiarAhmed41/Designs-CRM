import { useEffect, useRef } from 'react';
import { useIsFetching } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { finishPageProgress, startPageProgress } from '@/lib/pageProgress';

/** Top bar while a new page (or its first data) is still loading. */
export function PageProgress() {
  const { pathname } = useLocation();
  const { loading } = useAuth();
  const fetching = useIsFetching();
  const navAt = useRef(Date.now());
  const firstPaint = useRef(true);

  useEffect(() => {
    document.getElementById('lvd-boot')?.setAttribute('hidden', '');
  }, []);

  useEffect(() => {
    navAt.current = Date.now();
    if (firstPaint.current) {
      firstPaint.current = false;
      return;
    }
    startPageProgress();
  }, [pathname]);

  useEffect(() => {
    if (loading) return;
    const wait = Math.max(0, 200 - (Date.now() - navAt.current));
    const id = window.setTimeout(() => {
      if (fetching === 0) finishPageProgress();
    }, wait);
    return () => window.clearTimeout(id);
  }, [loading, fetching, pathname]);

  return null;
}

export function PageLoading() {
  return (
    <div className="page-loading" aria-busy="true" aria-label="Loading">
      <div className="skel-list">
        <div className="skel-row">
          <span className="skel skel-avatar" />
          <div className="skel-row-body">
            <span className="skel" style={{ width: '38%', height: 13 }} />
            <span className="skel" style={{ width: '62%', height: 11 }} />
          </div>
        </div>
        <div className="skel-row">
          <span className="skel skel-avatar" />
          <div className="skel-row-body">
            <span className="skel" style={{ width: '44%', height: 13 }} />
            <span className="skel" style={{ width: '70%', height: 11 }} />
          </div>
        </div>
        <div className="skel-row">
          <span className="skel skel-avatar" />
          <div className="skel-row-body">
            <span className="skel" style={{ width: '32%', height: 13 }} />
            <span className="skel" style={{ width: '55%', height: 11 }} />
          </div>
        </div>
      </div>
    </div>
  );
}
