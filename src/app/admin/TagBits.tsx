import { adminSetDisabledAction } from "./actions";

type Status = "unclaimed" | "active" | "disabled";
type Reason = "owner" | "admin" | "replaced" | null;

const REASON_TEXT: Record<Exclude<Reason, null>, string> = {
  owner: "by owner",
  admin: "by admin",
  replaced: "replaced",
};

export function StatusBadge({ status, reason }: { status: Status; reason: Reason }) {
  const text = status === "disabled" && reason ? `disabled (${REASON_TEXT[reason]})` : status;
  return <span className={`badge ${status}`}>{text}</span>;
}

/** Disable any unclaimed/active tag; re-enable only tags an admin disabled. */
export function AdminTagActions({ tagId, status, reason }: { tagId: string; status: Status; reason: Reason }) {
  if (status === "disabled" && reason !== "admin") return <span className="muted">—</span>;
  const disable = status !== "disabled";
  return (
    <form action={adminSetDisabledAction} className="inline">
      <input type="hidden" name="tagId" value={tagId} />
      <input type="hidden" name="disable" value={disable ? "1" : "0"} />
      <button type="submit" className={`small ${disable ? "danger" : "secondary"}`}>
        {disable ? "Disable" : "Enable"}
      </button>
    </form>
  );
}
