import type { Design, MyFile } from "./designs";
import type { Order } from "./types";
import type { EditRequest } from "./edits";
import {
  designOptionLabel,
  embroideryDesigns,
  sizeDetail,
  type EmbDesign,
} from "./embroideryQuote";
import { studioQuotation, type QuoteWithLines } from "./quoteHelpers";
import { orderDeliveryGroups } from "./serviceOrderView";
import { isImageFile, mergeDeliveredVia } from "./format";

type FilesOrder = Order & { designs?: Design[] };
export type SizeBox = {
  key: string;
  designId?: string | null;
  title: string;
  spec: string;
  files: MyFile[];
  emailed: boolean;
};

export type DesignSection = {
  name: string;
  boxes: SizeBox[];
};

export type FileEntry = {
  designNames?: string[];
  key: string;
  orderId: string;
  designId: string | null;
  designName: string;
  orderName: string | null;
  humanRef: string | null;
  serviceType: string | null;
  deliveredAt: string;
  deliveredVia: string | null;
  files: MyFile[];
  thumbUrl: string | null;
};

/** A size revision belongs only to that size; an order revision has no size IDs. */
export function revisionsForScope(
  edits: EditRequest[],
  orderId: string,
  designId: string | null,
) {
  return edits.filter((edit) => {
    if (edit.orderId !== orderId) return false;
    const ids = edit.designIds?.length
      ? edit.designIds
      : edit.designId
        ? [edit.designId]
        : [];
    return !designId || ids.length === 0 || ids.includes(designId);
  });
}

export function isPreviewFile(file: MyFile) {
  if (file.emailNotice || file.isBundle) return false;
  return (
    file.kind === "PREVIEW" ||
    (isImageFile(file.originalName, file.mimeType) &&
      !/\.svg$/i.test(file.originalName) &&
      file.mimeType !== "image/svg+xml")
  );
}
export function portalFiles(files: MyFile[]) {
  return files.filter((file) => !file.emailNotice);
}
export function downloadableFiles(files: MyFile[]) {
  return portalFiles(files).filter(
    (file) =>
      file.kind !== "PREVIEW" &&
      file.canDownload !== false &&
      !isPreviewFile(file),
  );
}
function batchEmailed(files: MyFile[]) {
  return files.some(
    (file) =>
      file.emailNotice || file.batchVia === "EMAIL" || file.batchVia === "BOTH",
  );
}
export function groupFileEntries(files: MyFile[]): FileEntry[] {
  const orders = new Map<string, FileEntry>();
  for (const file of files) {
    const existing = orders.get(file.orderId);
    if (existing) {
      if (!existing.files.some((item) => item.fileId === file.fileId))
        existing.files.push(file);
      existing.deliveredVia = mergeDeliveredVia([
        existing.deliveredVia,
        file.deliveredVia,
      ]);
      if (
        new Date(file.deliveredAt).getTime() >
        new Date(existing.deliveredAt).getTime()
      )
        existing.deliveredAt = file.deliveredAt;
      if (!existing.thumbUrl && file.previewUrl && isPreviewFile(file))
        existing.thumbUrl = file.previewUrl;
    } else {
      const designName = file.orderDesignNames?.length
        ? file.orderDesignNames.join(", ")
        : file.orderName?.trim() || file.designName?.trim() || "Order";
      orders.set(file.orderId, {
        key: file.orderId,
        orderId: file.orderId,
        designId: null,
        designNames: file.orderDesignNames,
        designName,
        orderName: file.orderName,
        humanRef: file.humanRef,
        serviceType: file.serviceType ?? null,
        deliveredAt: file.deliveredAt,
        deliveredVia: file.deliveredVia ?? null,
        files: [file],
        thumbUrl:
          file.previewUrl && isPreviewFile(file) ? file.previewUrl : null,
      });
    }
  }
  return [...orders.values()];
}
function sizeSpec(
  title: string,
  index: number,
  rowCount: number,
  rowName: string,
  designs: EmbDesign[],
) {
  const design = designs.find(
    (item, itemIndex) => designOptionLabel(itemIndex, item.name) === title,
  );
  const sizes = (design?.sizes ?? []).filter(
    (size) => size.detail || size.placement || size.w || size.h,
  );
  const matchedSize = sizes.find((size) =>
    [size.detail, size.label, sizeDetail(size)].some(
      (value) => value?.trim().toLowerCase() === rowName.trim().toLowerCase(),
    ),
  );
  const size =
    matchedSize ?? (sizes.length === rowCount ? sizes[index] : undefined);
  if (size) {
    const place = size?.placement?.trim();
    const detail = size ? sizeDetail(size) : "";
    const parts = [detail && detail !== "Size" ? detail : "", place].filter(
      Boolean,
    );
    if (parts.length) return parts.join(" · ");
  }
  const name = rowName.trim();
  if (!name || name === title) return "";
  return name;
}

function groupByDesignName(files: MyFile[]): DesignSection[] {
  const map = new Map<string, MyFile[]>();
  for (const file of files) {
    const name =
      file.designName?.trim() ||
      (file.isBundle ? "All designs files" : "Files");
    const list = map.get(name) ?? [];
    list.push(file);
    map.set(name, list);
  }
  return [...map.entries()].map(([name, items]) => ({
    name,
    boxes: [
      {
        key: name,
        title: items.length && name !== "Files" ? name : "Files",
        spec: "",
        files: items,
        emailed: batchEmailed(items),
      },
    ],
  }));
}

export function buildSections(
  order: FilesOrder | undefined,
  files: MyFile[],
  designId: string | null = null,
): DesignSection[] {
  const originals = files.filter(
    (file) =>
      !file.editId &&
      (!designId || file.designId === designId || !file.designId),
  );
  const portal = portalFiles(originals);
  const looseEmail = originals.some((file) => file.emailNotice);

  if (!order) {
    if (portal.length) return groupByDesignName(portal);
    if (looseEmail) {
      return [
        {
          name: "Files",
          boxes: [
            {
              key: "email",
              title: "Files",
              spec: "",
              files: [],
              emailed: true,
            },
          ],
        },
      ];
    }
    return [];
  }

  const designs = embroideryDesigns(order.preferences, order.name);
  const lines =
    studioQuotation((order.quotations ?? []) as QuoteWithLines[])?.lines ?? [];
  let groups = orderDeliveryGroups(order, lines);
  if (lines.length === 0) {
    const byName = new Map<string, (typeof groups)[number]>();
    for (const row of groups.flatMap((group) => group.rows)) {
      const title = row.design?.name?.trim() || row.name;
      const group = byName.get(title) ?? { title, rows: [] };
      group.rows.push(row);
      byName.set(title, group);
    }
    groups = [...byName.values()];
  }
  const used = new Set<string>();

  let sections: DesignSection[] = groups.map((group) => ({
    name: group.title,
    boxes: group.rows.map((row, index) => {
      const matched = portal.filter(
        (file) => file.designId && file.designId === row.design?.id,
      );
      matched.forEach((file) => used.add(file.fileId));
      const spec =
        sizeSpec(group.title, index, group.rows.length, row.name, designs) ||
        [row.design?.size, row.design?.placement].filter(Boolean).join(" · ");
      const severalSizes = group.rows.length > 1;
      return {
        key: row.key,
        designId: row.design?.id ?? null,
        title: severalSizes ? `Size ${index + 1}` : spec || group.title,
        spec: severalSizes ? spec : "",
        files: matched,
        emailed: batchEmailed(matched),
      };
    }),
  }));

  if (designId) {
    sections = sections
      .map((section) => ({
        ...section,
        boxes: section.boxes.filter((box) => box.designId === designId),
      }))
      .filter((section) => section.boxes.length > 0);
  }

  if (looseEmail) {
    const filled = sections
      .flatMap((section) => section.boxes)
      .filter((box) => box.files.length);
    const targets = filled.length
      ? filled
      : sections.flatMap((section) => section.boxes);
    targets.forEach((box) => {
      box.emailed = true;
    });
  }

  const leftover = portal.filter((file) => !used.has(file.fileId));
  const assigned = sections.some((section) =>
    section.boxes.some((box) => box.files.length > 0 || box.emailed),
  );

  if (!assigned) {
    if (leftover.length) return groupByDesignName(leftover);
    if (looseEmail && sections.length) return sections;
    if (looseEmail) {
      return [
        {
          name: "Files",
          boxes: [
            {
              key: "email",
              title: "Files",
              spec: "",
              files: [],
              emailed: true,
            },
          ],
        },
      ];
    }
    return sections;
  }

  sections = sections
    .map((section) => ({
      ...section,
      boxes: section.boxes.filter((box) => box.files.length > 0 || box.emailed),
    }))
    .filter((section) => section.boxes.length > 0);

  for (const extra of groupByDesignName(leftover)) {
    const existing = sections.find((section) => section.name === extra.name);
    if (existing) existing.boxes.push(...extra.boxes);
    else sections.push(extra);
  }
  return sections;
}
