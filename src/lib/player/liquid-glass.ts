export type GlassOptics = {
  zoom: number;
  refraction: number;
  dispersion: number;
  blur: number;
};

export const GLASS_DEFAULTS: GlassOptics = { zoom: 1.08, refraction: 1, dispersion: 1, blur: 1 };
export const GLASS_LIMITS = {
  zoom: [1, 1.1],
  refraction: [0, 1.2],
  dispersion: [0, 1.2],
  blur: [0, 1.2],
} as const;

export function normalizeGlassOptics(value: unknown): GlassOptics {
  const input = value && typeof value === "object" ? (value as Partial<GlassOptics>) : {};
  const result = { ...GLASS_DEFAULTS };
  for (const key of Object.keys(result) as (keyof GlassOptics)[]) {
    const number = input[key];
    const [min, max] = GLASS_LIMITS[key];
    if (typeof number === "number" && Number.isFinite(number)) {
      result[key] = Math.max(min, Math.min(max, number));
    }
  }
  return result;
}

export type GlassRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  radii?: [number, number, number, number];
};
export type GlassLayout = {
  regions: GlassRegion[];
  viewportWidth: number;
  viewportHeight: number;
  optics: GlassOptics;
};
