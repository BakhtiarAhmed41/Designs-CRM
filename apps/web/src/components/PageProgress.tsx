/** Centered brand loader while auth or a lazy page is still loading. */
export function PageLoading() {
  return (
    <div className="page-loader" role="status" aria-label="Loading">
      <img src="/lvd-logo.png" alt="" className="page-loader-logo" />
      <div className="page-loader-spin" />
    </div>
  );
}
