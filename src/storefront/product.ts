import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { catalogProductSchema, imageUrl, request } from "./api";
import { catalogQueryDefaults } from "./queries";

export const productIdSchema = z.number().int().positive().safe();
export const selectedProductSchema = catalogProductSchema
  .omit({ currency: true, categoryIds: true, image: true })
  .extend({
    id: productIdSchema,
    skuNumber: z.string().trim().min(1),
    filamentType: z.enum(["PLA", "PETG", "ABS"]),
    image: z.string().nullable().optional(),
    imageGallery: z.array(z.string()).default([]),
    compatibility: z.string().optional(),
  });
export const filamentSchema = z.object({
  publicId: z.string().uuid(),
  name: z.string().min(1),
  color: z.string().min(1),
  profile: selectedProductSchema.shape.filamentType,
  available: z.boolean(),
});
export const colorsSchema = z
  .object({ success: z.literal(true), data: z.array(filamentSchema) })
  .refine(
    ({ data }) =>
      new Set(data.map((color) => color.publicId)).size === data.length,
  );
export const configurationSchema = z.object({
  color: z.string(),
  quantity: z.string(),
});
export const configureActionSchema = configurationSchema
  .partial()
  .extend({ productId: productIdSchema });
export type Configuration = z.infer<typeof configurationSchema>;
export type SelectedProduct = z.infer<typeof selectedProductSchema>;
export const emptyConfiguration: Configuration = { color: "", quantity: "1" };

export const detailViewSchema = z.object({
  active: z.boolean(),
  ready: z.boolean(),
  title: z.string(),
  description: z.string(),
  productId: z.number(),
  sku: z.string(),
  material: z.string(),
  price: z.string(),
  compatibility: z.string(),
  images: z.array(z.object({ src: z.string(), name: z.string() })),
  retryVisible: z.boolean(),
  colorsReady: z.boolean(),
  colorsRetry: z.boolean(),
  colors: z.array(z.object({ value: z.string(), label: z.string() })),
  color: z.string(),
  quantity: z.string(),
  colorStatus: z.string(),
  quantityError: z.string(),
});
export type DetailView = z.infer<typeof detailViewSchema>;
export const emptyDetail: DetailView = {
  active: false,
  ready: false,
  title: "",
  description: "",
  productId: 0,
  sku: "",
  material: "",
  price: "",
  compatibility: "",
  images: [],
  retryVisible: false,
  colorsReady: false,
  colorsRetry: false,
  colors: [],
  color: "",
  quantity: "1",
  colorStatus:
    "Select a product when the catalog is available to see its options.",
  quantityError: "",
};
const prices = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function detailView(
  id: ReturnType<typeof productRoute>,
  queries: ReturnType<typeof useProduct>,
  config: Configuration,
): DetailView {
  if (id === null) return emptyDetail;
  const { product, colors } = queries;
  if (id === "invalid" || !product.data)
    return {
      ...emptyDetail,
      active: true,
      title:
        id === "invalid"
          ? "Product not found."
          : product.isError
            ? productFailure(product.error, "Product")
            : "Loading product…",
      retryVisible: id !== "invalid" && product.isError,
    };
  const data = product.data;
  const options =
    colors.isSuccess && !colors.isFetching ? colors.data.data : [];
  const selected = options.some((option) => option.publicId === config.color);
  return {
    ...emptyDetail,
    active: true,
    ready: true,
    productId: data.id,
    title: data.name,
    description: data.description,
    sku: data.skuNumber,
    material: data.filamentType,
    price: prices.format(data.price),
    compatibility: data.compatibility ?? "",
    images: [
      ...new Set([imageUrl(data.image), ...data.imageGallery.map(imageUrl)]),
    ]
      .filter(Boolean)
      .map((src) => ({ src, name: data.name })),
    colors: options.map((option) => ({
      value: option.publicId,
      label: `${option.color} — ${option.name} (${option.publicId})`,
    })),
    colorsReady: colors.isSuccess && !colors.isFetching,
    colorsRetry: colors.isError,
    color: selected ? config.color : "",
    quantity: config.quantity,
    quantityError: quantityValid(config.quantity)
      ? ""
      : "Enter a whole number from 1 to 69.",
    colorStatus:
      colors.isFetching || colors.isPending
        ? "Loading available colors…"
        : colors.isError
          ? productFailure(colors.error, "Colors")
          : config.color && !selected
            ? "Your selected color is unavailable. Choose another color."
            : options.length === 0
              ? "No colors are currently available for this material."
              : "Choose an available color.",
  };
}

export function quantityValid(value: string) {
  return /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 69;
}

export function productRoute(path: string): number | null | "invalid" {
  if (path === "/") return null;
  const match = /^\/products\/([1-9]\d*)\/?$/.exec(path);
  const parsed = productIdSchema.safeParse(Number(match?.[1]));
  return parsed.success ? parsed.data : "invalid";
}

export function productFailure(error: Error | null, subject: string) {
  if (error?.message === "HTTP 404") return `${subject} not found.`;
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return `Malformed ${subject.toLowerCase()} response. Please retry.`;
  if (error?.message.includes("timed out"))
    return `${subject} request timed out. Please retry.`;
  return `${subject} unavailable. Check your connection and retry.`;
}

export function useProduct(origin: string, id: number | null | "invalid") {
  const product = useQuery({
    ...catalogQueryDefaults,
    queryKey: ["selected-product", origin, id],
    enabled: typeof id === "number",
    gcTime: 0,
    queryFn: async ({ signal }) => {
      const result = await request(
        origin,
        `/product/${id}`,
        selectedProductSchema,
        signal,
      );
      return selectedProductSchema
        .refine((value) => value.id === id)
        .parse(result);
    },
  });
  const material = product.data?.filamentType;
  const colors = useQuery({
    ...catalogQueryDefaults,
    queryKey: ["product-colors", origin, id, material],
    enabled: Boolean(material),
    gcTime: 0,
    staleTime: 0,
    queryFn: ({ signal }) =>
      request(
        origin,
        `/v2/colors?profile=${material}&available=true`,
        colorsSchema.refine(({ data }) =>
          data.every((color) => color.profile === material && color.available),
        ),
        signal,
      ),
  });
  return { product, colors };
}
