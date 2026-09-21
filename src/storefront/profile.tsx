import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { apiOrigin, authClient } from "./auth";

const profileFields = z.object({
  firstName: z.string().trim().min(1, "Enter your first name."),
  lastName: z.string().trim().min(1, "Enter your last name."),
  shippingAddress: z.string().trim().min(10, "Enter your full street address."),
  city: z.string().trim().min(1, "Enter your city."),
  state: z
    .string()
    .trim()
    .min(1, "Enter your state.")
    .max(2, "Use the two-letter state code."),
  zipCode: z
    .string()
    .trim()
    .min(1, "Enter your ZIP code.")
    .max(5, "Use the five-digit ZIP code."),
  country: z.string().trim().min(1, "Enter your country code."),
  phone: z
    .string()
    .regex(
      /^\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})$/,
      "Enter a ten-digit phone number.",
    ),
});
type ProfileFields = z.infer<typeof profileFields>;
const storedFields = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  city: z.string(),
  state: z.string(),
  zipCode: z.string(),
  country: z.string(),
  phone: z.string(),
});
const readSchema = storedFields
  .extend({ address: z.string() })
  .transform(({ address, ...fields }) => ({
    ...fields,
    shippingAddress: address,
  }));
const writeSchema = storedFields.extend({ shippingAddress: z.string() });
type Profile = z.infer<typeof writeSchema>;

async function requestProfile(
  userId: string,
  values?: ProfileFields,
  signal?: AbortSignal,
) {
  const schema = values ? writeSchema : readSchema;
  const result = await authClient.$fetch<Profile>(
    values ? `/profile/${encodeURIComponent(userId)}` : "/profile",
    {
      baseURL: apiOrigin,
      method: values ? "POST" : "GET",
      credentials: "include",
      cache: "no-store",
      retry: 0,
      signal,
      ...(values ? { body: profileFields.parse(values) } : {}),
      output: schema.refine(
        (profile) => profile.id === userId,
        "Profile does not match this account.",
      ),
    },
  );
  if (result.error || !result.data)
    throw new Error(
      "Profile unavailable. Check your connection or sign in again.",
    );
  return result.data;
}

const fields = [
  { name: "firstName", label: "First name", autoComplete: "given-name" },
  { name: "lastName", label: "Last name", autoComplete: "family-name" },
  {
    name: "shippingAddress",
    label: "Street address",
    autoComplete: "street-address",
  },
  { name: "city", label: "City", autoComplete: "address-level2" },
  { name: "state", label: "State code", autoComplete: "address-level1" },
  { name: "zipCode", label: "ZIP code", autoComplete: "postal-code" },
  { name: "country", label: "Country code", autoComplete: "country" },
  { name: "phone", label: "Phone", autoComplete: "tel" },
] as const;

function ProfileForm({ profile }: { profile: Profile }) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ProfileFields>({
    resolver: zodResolver(profileFields),
    defaultValues: profile,
  });
  const save = useMutation({
    retry: false,
    mutationFn: (values: ProfileFields) => requestProfile(profile.id, values),
    onSuccess: (value) => reset(value),
  });
  return (
    <form
      aria-label="Shipping profile"
      className="mt-5 grid max-w-lg gap-3"
      onSubmit={handleSubmit((values) => save.mutate(values))}
    >
      <h2 className="font-display text-2xl">Shipping profile</h2>
      <p className="text-sm">
        Save the contact and shipping details you will review at checkout.
      </p>
      {fields.map((field) => (
        <div key={field.name} className="grid gap-1">
          <label htmlFor={`profile-${field.name}`}>{field.label}</label>
          <Input
            id={`profile-${field.name}`}
            autoComplete={field.autoComplete}
            {...register(field.name)}
            aria-invalid={Boolean(errors[field.name])}
            aria-describedby={`profile-${field.name}-error`}
          />
          <p id={`profile-${field.name}-error`} role="alert">
            {errors[field.name]?.message}
          </p>
        </div>
      ))}
      <Button disabled={save.isPending} type="submit">
        Save profile
      </Button>
      {save.isSuccess ? <p role="status">Profile saved.</p> : null}
      {save.error ? (
        <p role="alert">
          Profile could not be saved. Check your details and try again.
        </p>
      ) : null}
    </form>
  );
}

export function ProfilePanel({ userId }: { userId: string }) {
  const profile = useQuery({
    queryKey: ["profile", apiOrigin, userId],
    queryFn: ({ signal }) => requestProfile(userId, undefined, signal),
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  if (profile.isPending) return <p role="status">Loading your profile…</p>;
  if (profile.isError)
    return (
      <div className="mt-4">
        <p role="alert">Profile unavailable. Retry or sign in again.</p>
        <Button variant="outline" onClick={() => void profile.refetch()}>
          Retry profile
        </Button>
      </div>
    );
  return <ProfileForm key={userId} profile={profile.data} />;
}
