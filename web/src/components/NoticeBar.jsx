/**
 * Status line under the bar. Kept as a live region so a payment confirmation or
 * an error is announced without stealing focus.
 */
export default function NoticeBar({ notice }) {
  if (!notice?.message) return null;
  const kind = notice.kind === 'error' ? 'is-error' : notice.kind === 'success' ? 'is-success' : '';
  return (
    <p className={`notice ${kind}`.trim()} role="status">
      {notice.message}
    </p>
  );
}
