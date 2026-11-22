export type Label = {
  tagId: string;
  publicCode: string;
  qrSvg: string;
  /** Only present right after a batch is created or its codes are reissued. */
  claimCode?: string;
};

/** Grid of printable labels. The SVG is generated on our server from our own URL (see src/server/links.ts). */
export function LabelSheet({ labels }: { labels: Label[] }) {
  return (
    <div className="labels">
      {labels.map((l) => (
        <div className="label" key={l.tagId} data-tag-id={l.tagId}>
          <div role="img" aria-label={`QR code for ${l.publicCode}`} dangerouslySetInnerHTML={{ __html: l.qrSvg }} />
          <div className="code">{l.publicCode}</div>
          {l.claimCode && (
            <div className="claim">
              <span className="small">Claim code</span>
              <br />
              <span className="claim-code">{l.claimCode}</span>
            </div>
          )}
          <div className="small mono">{l.tagId}</div>
        </div>
      ))}
    </div>
  );
}
