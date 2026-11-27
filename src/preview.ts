import type { PageViewport, PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask, TextLayer } from "pdfjs-dist";
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PdfLocation, PdfPoint } from "./api";

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
type PageGeometry = { display: PageViewport; upright: PageViewport };
type PageRender = { task?: RenderTask; text?: TextLayer };

export class Preview {
  #loading?: PDFDocumentLoadingTask;
  #document?: PDFDocumentProxy;
  #pages: HTMLElement[] = [];
  #renders = new Map<number, PageRender>();
  #textLayer?: typeof TextLayer;
  #generation = 0;
  #fit = true;
  #zoom = 1;
  #geometry: PageGeometry[] = [];
  #current = 0;
  #observer: ResizeObserver;
  #scrollFrame = 0;
  #resizeTimer = 0;
  #mark?: HTMLElement;

  constructor(
    private readonly viewport: HTMLElement,
    private readonly stack: HTMLElement,
    private readonly status: (page: number, pages: number, zoom: string) => void,
  ) {
    this.#observer = new ResizeObserver(() => {
      clearTimeout(this.#resizeTimer);
      this.#resizeTimer = window.setTimeout(() => this.#layout(true), 70);
    });
    this.#observer.observe(viewport);
    viewport.addEventListener("scroll", () => {
      if (this.#scrollFrame) return;
      this.#scrollFrame = requestAnimationFrame(() => {
        this.#scrollFrame = 0;
        this.#visiblePages();
      });
    }, { passive: true });
  }

  get hasDocument() { return !!this.#document; }
  get currentPage() { return this.#current; }
  get pageCount() { return this.#pages.length; }

  async load(data?: Uint8Array, keepViewport = false) {
    const generation = ++this.#generation;
    if (!data) {
      const loading = this.#loading;
      this.#loading = undefined;
      this.#document = undefined;
      this.#clearPages();
      this.status(0, 0, "Fit");
      await loading?.destroy().catch(() => {});
      return;
    }

    const { getDocument, GlobalWorkerOptions, TextLayer } = await import("pdfjs-dist");
    if (generation !== this.#generation) return;
    GlobalWorkerOptions.workerSrc = worker;
    const next = getDocument({
      data: data.slice(), useSystemFonts: true,
      cMapUrl: new URL("pdf/cmaps/", location.href).href,
      standardFontDataUrl: new URL("pdf/standard_fonts/", location.href).href,
      wasmUrl: new URL("pdf/wasm/", location.href).href,
      iccUrl: new URL("pdf/iccs/", location.href).href,
    });
    let document: PDFDocumentProxy;
    let geometry: PageGeometry[];
    try {
      document = await next.promise;
      geometry = await Promise.all(Array.from({ length: document.numPages }, async (_, index) => {
        const page = await document.getPage(index + 1);
        return { display: page.getViewport({ scale: 1 }), upright: page.getViewport({ scale: 1, rotation: 0 }) };
      }));
    } catch (error) {
      await next.destroy().catch(() => {});
      if (generation === this.#generation) throw error;
      return;
    }
    if (generation !== this.#generation) {
      await next.destroy().catch(() => {});
      return;
    }
    const previous = this.#loading;
    const anchor = keepViewport ? this.#anchor() : undefined;
    this.#clearPages();
    this.#loading = next;
    this.#document = document;
    this.#geometry = geometry;
    this.#textLayer = TextLayer;
    this.#current = 1;
    if (!keepViewport || !previous) this.#fit = true;
    this.#pages = geometry.map((_, index) => {
      const page = window.document.createElement("div");
      page.className = "pdf-page";
      page.dataset.page = String(index + 1);
      page.setAttribute("aria-label", `PDF page ${index + 1}`);
      this.stack.append(page);
      return page;
    });
    this.#layout();
    if (anchor) this.#restore(anchor);
    else this.viewport.scrollTo(0, 0);
    this.#visiblePages();
    void previous?.destroy().catch(() => {});
  }

  #clearPages() {
    for (const index of this.#renders.keys()) this.#cancelRender(index);
    this.#pages = [];
    this.#current = 0;
    this.#mark = undefined;
    this.stack.replaceChildren();
  }

  zoom(step: number) {
    if (!this.#document) return;
    const scale = this.#fit ? this.#scale(this.#current - 1) : this.#zoom;
    this.#zoom = Math.max(0.25, Math.min(2.5, Math.round((scale + step) * 20) / 20));
    this.#fit = false;
    this.#layout(true);
  }

  fit() {
    this.#fit = true;
    this.viewport.scrollLeft = 0;
    this.#layout(true);
  }

  goToPage(page: number) {
    if (!this.#pages.length || !Number.isFinite(page)) return;
    const next = Math.max(1, Math.min(this.#pages.length, Math.round(page)));
    const target = this.#pages[next - 1];
    this.#scrollTo(target, Math.min(0.5, this.viewport.clientHeight / (2 * target.clientHeight)), true);
  }

  pointAt(event: MouseEvent): PdfPoint | null {
    const element = event.target instanceof Element ? event.target.closest<HTMLElement>(".pdf-page") : null;
    const page = Number(element?.dataset.page);
    if (!element || !this.#geometry[page - 1]) return null;
    const bounds = element.getBoundingClientRect();
    const { display, upright } = this.#geometry[page - 1];
    const pdf = display.convertToPdfPoint(
      (event.clientX - bounds.left) * display.width / bounds.width,
      (event.clientY - bounds.top) * display.height / bounds.height,
    );
    const [x, y] = upright.convertToViewportPoint(pdf[0], pdf[1]);
    return { page, x, y };
  }

  reveal(location: PdfLocation) {
    const { page, x, y, width, height } = location;
    const target = this.#pages[page - 1];
    if (!target) return;
    this.#layout();
    const { display, upright } = this.#geometry[page - 1];
    const corners = [[x, y - height], [x + width, y + 3]].map(([left, top]) => {
      const pdf = upright.convertToPdfPoint(left, top);
      return display.convertToViewportPoint(pdf[0], pdf[1]);
    });
    const mark = window.document.createElement("div");
    mark.className = "pdf-location";
    const [first, second] = corners;
    const top = Math.max(0, Math.min(first[1], second[1]));
    mark.style.top = `${top / display.height * 100}%`;
    mark.style.left = `${Math.max(0, Math.min(first[0], second[0])) / display.width * 100}%`;
    mark.style.width = `${Math.abs(second[0] - first[0]) / display.width * 100}%`;
    mark.style.height = `${Math.abs(second[1] - first[1]) / display.height * 100}%`;
    this.#mark?.remove();
    this.#mark = mark;
    target.append(mark);
    this.#scrollTo(target, top / display.height, true);
    window.setTimeout(() => { if (this.#mark === mark) { mark.remove(); this.#mark = undefined; } }, 2200);
  }

  #anchor() {
    const target = this.#pages[this.#current - 1];
    if (!target?.clientHeight) return;
    const viewport = this.viewport.getBoundingClientRect();
    const relative = (viewport.top + viewport.height / 2 - target.getBoundingClientRect().top) / target.clientHeight;
    return { page: this.#current, relative: Math.max(0, Math.min(1, relative)), left: this.viewport.scrollLeft };
  }

  #restore(anchor: { page: number; relative: number; left: number }) {
    const target = this.#pages[Math.min(this.#pages.length, anchor.page) - 1];
    if (!target) return;
    this.#scrollTo(target, anchor.relative);
    this.viewport.scrollLeft = anchor.left;
  }

  #scrollTo(target: HTMLElement, relative: number, smooth = false) {
    const frame = this.viewport.getBoundingClientRect();
    const top = this.viewport.scrollTop + target.getBoundingClientRect().top - frame.top +
      target.clientHeight * relative - frame.height / 2;
    this.viewport.scrollTo({ top, behavior: smooth && !reducedMotion.matches ? "smooth" : "instant" });
    this.#visiblePages();
  }

  #scale(index: number) {
    if (!this.#fit) return this.#zoom;
    const width = this.viewport.clientWidth;
    const margins = width > 480 ? 88 : 44;
    const height = this.viewport.clientHeight;
    const verticalPadding = width > 480 ? 66 : 44;
    return Math.max(0.15, Math.min(1.15,
      (width - margins) / this.#geometry[index].display.width, (height - verticalPadding) / this.#geometry[index].display.height));
  }

  #layout(preservePosition = false) {
    if (!this.#document || !this.viewport.clientWidth) return;
    const anchor = preservePosition ? this.#anchor() : undefined;
    this.#pages.forEach((page, index) => {
      const scale = this.#scale(index);
      const { width: baseWidth, height: baseHeight, userUnit } = this.#geometry[index].display;
      const width = Math.floor(baseWidth * scale);
      const height = Math.floor(baseHeight * scale);
      if (page.style.width === `${width}px` && page.style.height === `${height}px` && page.dataset.scale === String(scale)) return;
      page.style.width = `${width}px`;
      page.style.height = `${height}px`;
      page.style.setProperty("--total-scale-factor", String(scale * userUnit));
      page.dataset.scale = String(scale);
      page.dataset.rendered = "";
      this.#cancelRender(index);
      page.querySelector(".textLayer")?.remove();
    });
    if (anchor) this.#restore(anchor);
    this.#visiblePages();
  }

  #cancelRender(index: number) {
    const render = this.#renders.get(index);
    render?.task?.cancel();
    render?.text?.cancel();
    this.#renders.delete(index);
  }

  #visiblePages() {
    if (!this.#document || !this.viewport.clientWidth) return;
    const viewport = this.viewport.getBoundingClientRect();
    let area = 0;
    this.#pages.forEach((page, index) => {
      const bounds = page.getBoundingClientRect();
      const visible = Math.min(bounds.bottom, viewport.bottom) - Math.max(bounds.top, viewport.top);
      if (visible > area) {
        area = visible;
        this.#current = index + 1;
      }
      if (bounds.bottom > viewport.top - 240 && bounds.top < viewport.bottom + 240) {
        if (!page.dataset.rendered) void this.#render(index, page);
      } else if (page.dataset.rendered || page.querySelector("canvas")) {
        this.#cancelRender(index);
        for (const child of Array.from(page.children)) if (child !== this.#mark) child.remove();
        page.dataset.rendered = "";
      }
    });
    this.status(this.#current, this.#pages.length, this.#fit ? "Fit" : `${Math.round(this.#zoom * 100)}%`);
  }

  async #render(index: number, wrapper: HTMLElement) {
    const document = this.#document;
    const scale = Number(wrapper.dataset.scale);
    const TextLayer = this.#textLayer;
    if (!document || !TextLayer || !scale) return;
    const run: PageRender = {};
    const current = () => document === this.#document && this.#renders.get(index) === run;
    wrapper.dataset.rendered = String(scale);
    this.#renders.set(index, run);
    try {
      const page = await document.getPage(index + 1);
      if (!current()) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: scale * ratio });
      const canvas = window.document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      run.task = page.render({ canvas, viewport });
      await run.task.promise;
      if (!current()) return;
      for (const child of Array.from(wrapper.childNodes)) if (child !== this.#mark) child.remove();
      wrapper.prepend(canvas);
      const layer = window.document.createElement("div");
      layer.className = "textLayer";
      wrapper.insertBefore(layer, this.#mark?.parentElement === wrapper ? this.#mark : null);
      run.text = new TextLayer({ container: layer, viewport: page.getViewport({ scale }), textContentSource: page.streamTextContent() });
      await run.text.render();
    } catch (error) {
      if (current() && !wrapper.querySelector("canvas") && (error as Error).name !== "RenderingCancelledException") {
        wrapper.textContent = "This page couldn’t be displayed.";
      }
    } finally {
      if (current()) this.#renders.delete(index);
    }
  }
}
