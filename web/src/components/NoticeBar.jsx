import { Notice as FlowbiteNotice } from './ui.jsx';

/**
 * Status line under the bar. Kept as a live region so a payment confirmation or
 * an error is announced without stealing focus.
 */
export default function NoticeBar({ notice }) {
  if (!notice?.message) return null;
  return <FlowbiteNotice kind={notice.kind}>{notice.message}</FlowbiteNotice>;
}
