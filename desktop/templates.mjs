const layouts = {
  article: ["Introduction", "Conclusion"],
  "lab-report": ["Objective", "Method", "Results", "Discussion", "Conclusion"],
  coursework: ["Problem 1", "Problem 2"],
};

export const templates = [
  { id: "article", label: "Article", sections: layouts.article },
  { id: "lab-report", label: "Lab report", sections: layouts["lab-report"] },
  { id: "coursework", label: "Coursework", sections: layouts.coursework },
];

export function texText(text) {
  const escapes = { "\\": "\\textbackslash{}", "^": "\\textasciicircum{}", "~": "\\textasciitilde{}" };
  return text.replace(/[\\#$%&_{}^~]/g, character => escapes[character] ?? "\\" + character);
}

export function projectTemplate({ title, author, course, template }) {
  if (!Object.hasOwn(layouts, template)) throw new Error("Choose a known LaTeX template.");
  const authorLine = [author, course].filter(Boolean).map(texText).join(" \\\\ ");
  return [
    "\\documentclass[11pt,a4paper]{article}",
    "",
    `\\title{${texText(title)}}`,
    `\\author{${authorLine}}`,
    "\\date{}",
    "",
    "\\begin{document}",
    "\\maketitle",
    "",
    ...layouts[template].flatMap(title => [`\\section{${title}}`, "", ""]),
    "\\end{document}",
    "",
  ].join("\n");
}
