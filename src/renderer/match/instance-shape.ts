import type { OciInstance } from "../oci/types";

function sizeParts(
  config: OciInstance["shape-config"],
  ocpus: (value: number) => string,
  memory: (value: number) => string,
): string[] {
  const parts: string[] = [];
  if (config?.ocpus !== undefined) parts.push(ocpus(config.ocpus));
  if (config?.["memory-in-gbs"] !== undefined) parts.push(memory(config["memory-in-gbs"]));
  return parts;
}

function joinShape(shape: string | undefined, parts: string[], separator: string): string | undefined {
  const size = parts.join(separator);
  if (size === "") return shape;
  return shape ? `${shape} ${size}` : size;
}

/** 詳細パネルのShape行。例: `VM.Standard.E4.Flex 2 OCPU / 16 GB` */
export function shapeText(instance: OciInstance): string | undefined {
  return joinShape(
    instance.shape,
    sizeParts(
      instance["shape-config"],
      (value) => `${value} OCPU`,
      (value) => `${value} GB`,
    ),
    " / ",
  );
}

/** 図のノードラベルに添える要約。例: `VM.Standard.E4.Flex 2c/16G` */
export function shapeSummary(instance: OciInstance): string | undefined {
  return joinShape(
    instance.shape,
    sizeParts(
      instance["shape-config"],
      (value) => `${value}c`,
      (value) => `${value}G`,
    ),
    "/",
  );
}

function shortAvailabilityDomain(value: string): string {
  return /AD-\d+$/.exec(value)?.[0] ?? value;
}

function shortFaultDomain(value: string): string {
  const index = /^FAULT-DOMAIN-(\d+)$/.exec(value)?.[1];
  return index === undefined ? value : `FD-${index}`;
}

/** 図のノードラベルに添えるAD/FDの短縮。例: `AD-1 / FD-2`(短縮できない値は原文のまま出す) */
export function placementSummary(instance: OciInstance): string | undefined {
  const ad = instance["availability-domain"];
  const fd = instance["fault-domain"];
  const parts = [ad ? shortAvailabilityDomain(ad) : undefined, fd ? shortFaultDomain(fd) : undefined].filter(
    (part): part is string => !!part,
  );
  return parts.length > 0 ? parts.join(" / ") : undefined;
}

/** 一覧のOCPU / Memory列。例: `2 / 16 GB` */
export function ocpuMemoryText(instance: OciInstance | undefined): string | undefined {
  if (!instance) return undefined;
  return (
    sizeParts(
      instance["shape-config"],
      (value) => `${value}`,
      (value) => `${value} GB`,
    ).join(" / ") || undefined
  );
}
