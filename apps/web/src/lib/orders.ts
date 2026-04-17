import { apiFetch, apiFetchForm } from "./api";
import type { User } from "./auth";

export type OrderStatus =
  | "CREATED"
  | "IN_PROGRESS"
  | "REJECTED"
  | "COMPLETED"
  | "CLOSED"
  | "REVISION_REQUESTED"
  | "PENDING_PAYMENT";

export type OrderAttachment = {
  id: string;
  orderId: string;
  originalName: string;
  mimeType: string | null;
  byteSize: number | null;
  createdAt: string;
};

export type OrderDeliveryFile = {
  id: string;
  deliveryId: string;
  originalName: string;
  mimeType: string | null;
  byteSize: number | null;
  createdAt: string;
};

export type OrderDelivery = {
  id: string;
  orderId: string;
  version: number;
  createdAt: string;
  files: OrderDeliveryFile[];
};

export type Order = {
  id: string;
  clientId: string;
  status: OrderStatus;
  serviceType: string;
  instructions: string | null;
  size: string | null;
  preferences: any;
  rejectionReason: string | null;
  createdAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  completedAt: string | null;
  closedAt: string | null;
  attachments: OrderAttachment[];
  deliveries: OrderDelivery[];
};

export type AdminOrder = Order & {
  client: User;
};

export async function createOrder(input: {
  serviceType: string;
  instructions?: string | null;
  size?: string | null;
  preferences?: any;
}) {
  return apiFetch<{ order: Order }>("/orders", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function uploadOrderAttachments(orderId: string, files: File[]) {
  const form = new FormData();
  for (const f of files) form.append("files", f);
  return apiFetchForm<{ attachments: OrderAttachment[] }>(`/orders/${orderId}/attachments`, form);
}

export async function listMyOrders() {
  return apiFetch<{ orders: Order[] }>("/orders");
}

export async function getMyOrder(orderId: string) {
  return apiFetch<{ order: Order }>(`/orders/${orderId}`);
}

export async function getMyAttachmentSignedUrl(orderId: string, attachmentId: string) {
  return apiFetch<{ url: string }>(`/orders/${orderId}/attachments/${attachmentId}/signed-url`);
}

export async function getMyDeliveryFileSignedUrl(orderId: string, deliveryFileId: string) {
  return apiFetch<{ url: string }>(`/orders/${orderId}/delivery-files/${deliveryFileId}/signed-url`);
}

export async function adminListOrders(filters: { status?: OrderStatus; clientId?: string } = {}) {
  const sp = new URLSearchParams();
  if (filters.status) sp.set("status", filters.status);
  if (filters.clientId) sp.set("clientId", filters.clientId);
  const qs = sp.toString();
  return apiFetch<{ orders: AdminOrder[] }>(`/admin/orders${qs ? `?${qs}` : ""}`);
}

export async function adminGetOrder(orderId: string) {
  return apiFetch<{ order: AdminOrder }>(`/admin/orders/${orderId}`);
}

export async function adminApproveOrder(orderId: string) {
  return apiFetch<{ order: AdminOrder }>(`/admin/orders/${orderId}/approve`, { method: "PATCH" });
}

export async function adminRejectOrder(orderId: string, reason: string) {
  return apiFetch<{ order: AdminOrder }>(`/admin/orders/${orderId}/reject`, {
    method: "PATCH",
    body: JSON.stringify({ reason }),
  });
}

export async function adminDeliverOrder(orderId: string, files: File[]) {
  const form = new FormData();
  for (const f of files) form.append("files", f);
  return apiFetchForm<{ order: Order; delivery: OrderDelivery }>(`/admin/orders/${orderId}/deliveries`, form);
}

export async function adminGetAttachmentSignedUrl(orderId: string, attachmentId: string) {
  return apiFetch<{ url: string }>(`/admin/orders/${orderId}/attachments/${attachmentId}/signed-url`);
}

export async function adminGetDeliveryFileSignedUrl(orderId: string, deliveryFileId: string) {
  return apiFetch<{ url: string }>(`/admin/orders/${orderId}/delivery-files/${deliveryFileId}/signed-url`);
}

/**
 * Download a file from a signed URL without navigating away.
 * Uses a blob + temporary `<a download>` so images/PDFs save instead of opening inline.
 */
export async function downloadSignedFile(url: string, filename: string): Promise<void> {
  const safeName = filename?.trim() || "download";
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = safeName;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    window.location.assign(url);
  }
}

