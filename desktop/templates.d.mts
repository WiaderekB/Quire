export type TemplateId = "article" | "lab-report" | "coursework";
export const templates: { id: TemplateId; label: string; sections: string[] }[];
export function texText(text: string): string;
export function projectTemplate(options: {
  title: string; author: string; course: string; template: TemplateId;
}): string;
