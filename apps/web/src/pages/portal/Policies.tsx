import { PageHeader } from '@/components/ui/PageHeader';

export function PortalPolicies() {
  return (
    <div>
      <PageHeader
        title="Policies"
        subtitle="Refund policy and edit policy for your orders."
      />

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Refund Policy</h2>
        <p>
          Quotes are priced before work starts. If you pay per order, payment is taken when you
          accept the quote. Monthly accounts are billed on the statement for that month.
        </p>
        <p>
          If work has not started, ask the team about a refund or store credit. After production
          has begun, refunds are reviewed case by case. File format add-ons that you already
          downloaded are not refundable.
        </p>
        <p>
          To request a refund, send a message from this portal with the order number and the
          reason. The team will reply with the next step.
        </p>
      </div>

      <div className="card card-pad">
        <h2 style={{ marginTop: 0 }}>Edit Policy</h2>
        <p>
          After files are delivered you can request a revision from the order. Small corrections
          that match the original brief are usually free. Bigger changes, new artwork, or extra
          sizes may be billed as a paid edit.
        </p>
        <p>
          Open the order, choose Request revision, and describe what to change. The team will
          confirm if the edit is free or paid before they start.
        </p>
      </div>
    </div>
  );
}
