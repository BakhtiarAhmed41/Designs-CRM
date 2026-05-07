 "use client";
 
 import { useMemo } from "react";
 
 export type MainCategory = "Embroidery" | "SVG" | "Custom vector" | "CNC and Laser Cut";
 
 export const CATEGORY_TREE: Record<
   MainCategory,
   { title: string; subCategories: string[] }
 > = {
   Embroidery: {
     title: "Embroidery Digitizing",
     subCategories: [
       "Left Chest Digitizing",
       "Hats & Caps Digitizing",
       "Jacket Back Digitizing",
       "Pets and Portraits Digitizing",
       "Cars and Trucks Digitizing",
       "Appliqué Digitizing",
       "Request Free color change",
     ],
   },
   SVG: {
     title: "SVG & Cut Files",
     subCategories: [
       "One Color SVG",
       "Full Color SVG",
       "Cricut & Silhouette",
       "Line Art and Illustration",
     ],
   },
   "Custom vector": {
     title: "Print - Ready Files",
     subCategories: [
       "Image to Vector",
       "Color Separation",
       "DTF Print Files",
       "Screen Print Files",
     ],
   },
   "CNC and Laser Cut": {
     title: "CNC & Laser Files",
     subCategories: [
       "CNC Cut Files",
       "Laser Cut Files",
       "Engraving Files",
       "Stencil Designs",
       "Plasma Cut Files",
     ],
   },
 };
 
 export function CategorySelect({
   mainCategory,
   subCategory,
   onChange,
   disabled,
 }: {
   mainCategory: MainCategory | "";
   subCategory: string;
   onChange: (next: { mainCategory: MainCategory | ""; subCategory: string }) => void;
   disabled?: boolean;
 }) {
   const subs = useMemo(() => {
     if (!mainCategory) return [];
     return CATEGORY_TREE[mainCategory].subCategories;
   }, [mainCategory]);
 
   return (
     <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
       <div className="sm:col-span-1">
         <label className="crm-label" htmlFor="mainCategory">
           Category
         </label>
         <select
           id="mainCategory"
           className="crm-field"
           disabled={disabled}
           value={mainCategory}
           onChange={(e) => {
             const v = e.target.value as MainCategory | "";
             onChange({ mainCategory: v, subCategory: "" });
           }}
         >
           <option value="">Select a category</option>
           {Object.keys(CATEGORY_TREE).map((k) => (
             <option key={k} value={k}>
               {k}
             </option>
           ))}
         </select>
       </div>
 
       <div className="sm:col-span-2">
         <label className="crm-label" htmlFor="subCategory">
           Sub category
         </label>
         <select
           id="subCategory"
           className="crm-field"
           disabled={disabled || !mainCategory}
           value={subCategory}
           onChange={(e) => onChange({ mainCategory, subCategory: e.target.value })}
         >
           <option value="">
             {mainCategory ? `Select from ${CATEGORY_TREE[mainCategory].title}` : "Select a category first"}
           </option>
           {subs.map((s) => (
             <option key={s} value={s}>
               {s}
             </option>
           ))}
         </select>
       </div>
     </div>
   );
 }
 
