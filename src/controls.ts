export function field(label: string, name: string, options: Partial<HTMLInputElement> = {}) {
  const wrap = document.createElement("label");
  wrap.className = "field";
  wrap.append(document.createTextNode(label));
  const input = document.createElement("input");
  input.name = name;
  Object.assign(input, options);
  wrap.append(input);
  return wrap;
}

export function select(label: string, name: string, options: [string, string][], value: string) {
  const wrap = document.createElement("label");
  wrap.className = "field";
  wrap.append(document.createTextNode(label));
  const input = document.createElement("select");
  input.name = name;
  for (const [key, title] of options) input.add(new Option(title, key, false, key === value));
  wrap.append(input);
  return wrap;
}

export const value = (data: FormData, name: string) => String(data.get(name) ?? "").trim();
