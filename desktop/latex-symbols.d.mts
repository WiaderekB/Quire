export type SourceLocation = { path: string; line: number; column: number };
export type Heading = SourceLocation & { kind: "heading"; title: string; level: number };
export type SymbolLocation = SourceLocation & { key: string };
export type Structure = Heading | (SourceLocation & { kind: "include"; target: string });
export function latexSymbols(text: string, path: string): { structure: Structure[]; labels: SymbolLocation[] };
export function bibliographySymbols(text: string, path: string): SymbolLocation[];
