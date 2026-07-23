export function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <div>
      <div className="ph">
        <div>
          <h1>{title}</h1>
          <div className="sub">{note}</div>
        </div>
      </div>
      <div className="card">
        <div className="card-b">
          <div className="note">
            <span>This screen is scaffolded and will be built out next.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
