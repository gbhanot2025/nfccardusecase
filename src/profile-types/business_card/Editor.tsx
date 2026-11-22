"use client";

import { EditorForm, SelectField, TextField, useProfileEditor, useRows } from "../shared/editor";
import { EMAIL_MAX, PHONE_MAX_INPUT, URL_MAX } from "../shared/fields";
import type { EditorProps } from "../shared/types";
import {
  BUSINESS_CARD_LIMITS,
  EMAIL_LABELS,
  EMAIL_LABEL_TEXT,
  PHONE_LABELS,
  PHONE_LABEL_TEXT,
  SOCIAL_NETWORKS,
  SOCIAL_NETWORK_IDS,
  businessCardFromFormData,
  validateBusinessCardData,
  type BusinessCardData,
} from "./schema";

const LISTS = [
  { prefix: "phones", required: "number" },
  { prefix: "emails", required: "address" },
  { prefix: "socials", required: "url" },
] as const;

const PHONE_OPTIONS = PHONE_LABELS.map((value) => ({ value, label: PHONE_LABEL_TEXT[value] }));
const EMAIL_OPTIONS = EMAIL_LABELS.map((value) => ({ value, label: EMAIL_LABEL_TEXT[value] }));
const NETWORK_OPTIONS = SOCIAL_NETWORK_IDS.map((value) => ({ value, label: SOCIAL_NETWORKS[value].label }));

/** Owner's form for a digital business card. */
export function BusinessCardEditor({ action, initialData }: EditorProps<BusinessCardData>) {
  const { errors, ...form } = useProfileEditor({
    action,
    fromFormData: businessCardFromFormData,
    validate: validateBusinessCardData,
    lists: LISTS,
  });
  const phones = useRows(initialData.phones, BUSINESS_CARD_LIMITS.phones);
  const emails = useRows(initialData.emails, BUSINESS_CARD_LIMITS.emails);
  const socials = useRows(initialData.socials, BUSINESS_CARD_LIMITS.socials);

  return (
    <EditorForm {...form}>
      <TextField
        label="Full name"
        name="name"
        autoComplete="name"
        defaultValue={initialData.name}
        maxLength={BUSINESS_CARD_LIMITS.name}
        error={errors.name}
      />
      <TextField
        label="Job title"
        name="title"
        autoComplete="organization-title"
        defaultValue={initialData.title}
        maxLength={BUSINESS_CARD_LIMITS.title}
        error={errors.title}
      />
      <TextField
        label="Company"
        name="company"
        autoComplete="organization"
        defaultValue={initialData.company}
        maxLength={BUSINESS_CARD_LIMITS.company}
        error={errors.company}
      />
      <TextField
        label="About"
        name="bio"
        kind="textarea"
        defaultValue={initialData.bio}
        maxLength={BUSINESS_CARD_LIMITS.bio}
        error={errors.bio}
      />

      <fieldset>
        <legend>Phone numbers</legend>
        {phones.rows.map((row, i) => (
          <div className="pp-row" key={row.key}>
            <SelectField
              label={`Phone type ${i + 1}`}
              name={`phones.${i}.label`}
              defaultValue={row.value?.label ?? "mobile"}
              options={PHONE_OPTIONS}
              error={errors[`phones.${i}.label`]}
            />
            <TextField
              label={`Phone number ${i + 1}`}
              name={`phones.${i}.number`}
              kind="tel"
              autoComplete="tel"
              defaultValue={row.value?.number}
              maxLength={PHONE_MAX_INPUT}
              placeholder="+44 20 7946 0958"
              error={errors[`phones.${i}.number`]}
            />
            <button type="button" className="secondary" onClick={() => phones.remove(row.key)}>
              Remove phone {i + 1}
            </button>
          </div>
        ))}
        {phones.canAdd && (
          <button type="button" className="secondary" onClick={phones.add}>
            Add phone
          </button>
        )}
      </fieldset>

      <fieldset>
        <legend>Email addresses</legend>
        {emails.rows.map((row, i) => (
          <div className="pp-row" key={row.key}>
            <SelectField
              label={`Email type ${i + 1}`}
              name={`emails.${i}.label`}
              defaultValue={row.value?.label ?? "work"}
              options={EMAIL_OPTIONS}
              error={errors[`emails.${i}.label`]}
            />
            <TextField
              label={`Email address ${i + 1}`}
              name={`emails.${i}.address`}
              kind="email"
              autoComplete="email"
              defaultValue={row.value?.address}
              maxLength={EMAIL_MAX}
              error={errors[`emails.${i}.address`]}
            />
            <button type="button" className="secondary" onClick={() => emails.remove(row.key)}>
              Remove email {i + 1}
            </button>
          </div>
        ))}
        {emails.canAdd && (
          <button type="button" className="secondary" onClick={emails.add}>
            Add email
          </button>
        )}
      </fieldset>

      <TextField
        label="Website"
        name="website"
        kind="url"
        autoComplete="url"
        defaultValue={initialData.website}
        maxLength={URL_MAX}
        placeholder="https://"
        error={errors.website}
      />
      <TextField
        label="Company page"
        name="companyUrl"
        kind="url"
        defaultValue={initialData.companyUrl}
        maxLength={URL_MAX}
        placeholder="https://"
        error={errors.companyUrl}
      />

      <fieldset>
        <legend>Social profiles</legend>
        {socials.rows.map((row, i) => (
          <div className="pp-row" key={row.key}>
            <SelectField
              label={`Social network ${i + 1}`}
              name={`socials.${i}.network`}
              defaultValue={row.value?.network ?? "linkedin"}
              options={NETWORK_OPTIONS}
              error={errors[`socials.${i}.network`]}
            />
            <TextField
              label={`Social profile link ${i + 1}`}
              name={`socials.${i}.url`}
              kind="url"
              defaultValue={row.value?.url}
              maxLength={URL_MAX}
              placeholder="https://"
              error={errors[`socials.${i}.url`]}
            />
            <button type="button" className="secondary" onClick={() => socials.remove(row.key)}>
              Remove social profile {i + 1}
            </button>
          </div>
        ))}
        {socials.canAdd && (
          <button type="button" className="secondary" onClick={socials.add}>
            Add social profile
          </button>
        )}
      </fieldset>
    </EditorForm>
  );
}
