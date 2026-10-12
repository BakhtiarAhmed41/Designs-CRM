const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");

const output = path.join(
  os.tmpdir(),
  `designs-crm-file-groups-${process.pid}.cjs`,
);
esbuild.buildSync({
  entryPoints: [path.join(__dirname, "../src/lib/fileGroups.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: output,
});
const {
  groupFileEntries,
  buildSections,
  downloadableFiles,
  isPreviewFile,
  revisionsForScope,
} = require(output);
fs.unlinkSync(output);
const file = (id, designId, extra = {}) => ({
  fileId: id,
  orderId: "order-a",
  orderName: "Artwork",
  orderDesignNames: ["Bahmas", "Line creek"],
  designId,
  designName: designId,
  originalName: id + ".dst",
  deliveredAt: "2026-10-13",
  kind: "FINAL",
  canDownload: true,
  ...extra,
});
const files = [
  file("small", "size-a"),
  file("large", "size-b"),
  file("creek", "size-c"),
  file("preview", "size-a", {
    originalName: "preview.png",
    mimeType: "image/png",
    previewUrl: "/preview.png",
  }),
];
const entries = groupFileEntries([
  ...files,
  files[0],
  file("other-order", "size-a", { orderId: "order-b" }),
]);
assert.equal(
  entries.length,
  2,
  "Rows must be grouped by order, even with the same design IDs or names",
);
assert.equal(
  entries[0].files.length,
  4,
  "A repeated file must not be counted twice",
);
assert.equal(entries[0].designName, "Bahmas, Line creek");
const order = {
  type: "ORDER",
  name: "Artwork",
  preferences: {
    designs: [
      {
        name: "Bahmas",
        sizes: [
          { detail: "3.5 inch", placement: "Polo" },
          { detail: "10 inch", placement: "Jacket/Fleece" },
        ],
      },
      { name: "Line creek", sizes: [{ detail: "4 inch", placement: "Cap" }] },
    ],
  },
  designs: [
    { id: "size-a", name: "3.5 inch", status: "DELIVERED" },
    { id: "size-b", name: "10 inch", status: "DELIVERED" },
    { id: "size-c", name: "4 inch", status: "DELIVERED" },
  ],
  quotations: [
    {
      id: "quote",
      createdByRole: "ADMIN",
      status: "APPROVED",
      version: 1,
      lines: [
        {
          id: "line-a",
          name: "3.5 inch",
          note: "design:Bahmas",
          clientDecision: "KEPT",
          sizes: [],
        },
        {
          id: "line-b",
          name: "10 inch",
          note: "design:Bahmas",
          clientDecision: "KEPT",
          sizes: [],
        },
        {
          id: "line-c",
          name: "4 inch",
          note: "design:Line creek",
          clientDecision: "KEPT",
          sizes: [],
        },
      ],
    },
  ],
};
const sections = buildSections(order, files);
assert.deepEqual(
  sections.map((section) => [section.name, section.boxes.length]),
  [
    ["Bahmas", 2],
    ["Line creek", 1],
  ],
  "Each design must keep its own sizes",
);
assert.deepEqual(
  sections[0].boxes.map((box) => box.files.map((item) => item.fileId)),
  [["small", "preview"], ["large"]],
  "Files must stay with the correct size",
);
assert.equal(sections[0].boxes[0].spec, "3.5 inch · Polo");
assert.deepEqual(
  downloadableFiles(files).map((item) => item.fileId),
  ["small", "large", "creek"],
  "Preview images must not be included in production downloads",
);
const vector = file("vector", "size-a", {
  originalName: "art.svg",
  mimeType: "image/svg+xml",
});
assert.equal(
  isPreviewFile(vector),
  false,
  "A production SVG must remain downloadable",
);
assert.equal(downloadableFiles([vector]).length, 1);
const edits = [
  { id: "small-revision", orderId: "order-a", designIds: ["size-a"] },
  {
    id: "large-revision",
    orderId: "order-a",
    designId: "size-b",
    designIds: [],
  },
  { id: "order-revision", orderId: "order-a", designIds: [] },
  { id: "other-order-revision", orderId: "order-b", designIds: ["size-a"] },
];
assert.deepEqual(
  revisionsForScope(edits, "order-a", "size-a").map((edit) => edit.id),
  ["small-revision", "order-revision"],
  "A size must not show revisions for another size or order",
);
assert.deepEqual(
  revisionsForScope(edits, "order-a", "size-c").map((edit) => edit.id),
  ["order-revision"],
  "Order-wide revisions apply to every size, but other size revisions do not",
);
assert.deepEqual(
  revisionsForScope(edits, "order-b", null).map((edit) => edit.id),
  ["other-order-revision"],
  "An order must not show another order’s revisions",
);
assert.deepEqual(
  revisionsForScope(edits.slice(0, 2), "order-a", "size-c"),
  [],
  "An unaffected size must have no revisions tab",
);
const scoped = buildSections(order, files, "size-a");
assert.deepEqual(
  scoped.map((section) => [section.name, section.boxes.length]),
  [["Bahmas", 1]],
  "A size detail must not include other sizes",
);
const shared = file("package", null, {
  originalName: "all-designs.zip",
  designName: null,
  isBundle: true,
});
const withExtras = buildSections(order, [
  ...files,
  shared,
  file("revision", "size-a", { editId: "revision-one" }),
]);
assert.equal(
  withExtras.find((section) => section.name === "All designs files").boxes[0]
    .files[0].fileId,
  "package",
  "Shared packages need their own section",
);
assert.equal(
  withExtras
    .flatMap((section) => section.boxes.flatMap((box) => box.files))
    .some((item) => item.editId),
  false,
  "Revision files must stay outside original delivery sections",
);
console.log(
  "Passed: order grouping, duplicate files, design/size ownership, preview separation, SVG downloads, shared packages, revision separation.",
);
