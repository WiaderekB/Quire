import bookOpen from "lucide/icons/book-open.svg?raw";
import check from "lucide/icons/check.svg?raw";
import chevronDown from "lucide/icons/chevron-down.svg?raw";
import chevronRight from "lucide/icons/chevron-right.svg?raw";
import circleAlert from "lucide/icons/circle-alert.svg?raw";
import cloud from "lucide/icons/cloud.svg?raw";
import cloudCheck from "lucide/icons/cloud-check.svg?raw";
import columns2 from "lucide/icons/columns-2.svg?raw";
import download from "lucide/icons/download.svg?raw";
import externalLink from "lucide/icons/external-link.svg?raw";
import file from "lucide/icons/file.svg?raw";
import fileCode from "lucide/icons/file-code-2.svg?raw";
import fileText from "lucide/icons/file-text.svg?raw";
import folder from "lucide/icons/folder.svg?raw";
import folderOpen from "lucide/icons/folder-open.svg?raw";
import layers from "lucide/icons/layers-2.svg?raw";
import list from "lucide/icons/list.svg?raw";
import minus from "lucide/icons/minus.svg?raw";
import panelLeft from "lucide/icons/panel-left.svg?raw";
import play from "lucide/icons/play.svg?raw";
import plus from "lucide/icons/plus.svg?raw";
import refresh from "lucide/icons/refresh-cw.svg?raw";
import scan from "lucide/icons/scan.svg?raw";
import search from "lucide/icons/search.svg?raw";
import settings from "lucide/icons/settings-2.svg?raw";
import gear from "lucide/icons/settings.svg?raw";
import terminal from "lucide/icons/terminal.svg?raw";
import x from "lucide/icons/x.svg?raw";

const icons = {
  bookOpen, check, chevronDown, chevronRight, circleAlert, cloud, cloudCheck, columns2,
  download, externalLink, file, fileCode, fileText, folder, folderOpen, gear, layers, list, minus,
  panelLeft, play, plus, refresh, scan, search, settings, terminal, x,
};
export type Icon = keyof typeof icons;
export const icon = (name: Icon) => icons[name].replace("<svg", '<svg aria-hidden="true" focusable="false"');

export function iconButton(name: Icon, label: string, id?: string) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-button";
  if (id) button.id = id;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = icon(name);
  return button;
}
