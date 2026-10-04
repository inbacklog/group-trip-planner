import { useState } from "react";
import { ExternalLink, MapPin } from "lucide-react";
import {
  DETAIL_FIELDS,
  getItemPresentation,
  getItemSources,
  safeImageUrl,
  type ItemPresentation,
} from "../lib/itemDetails";
import { safeExternalUrl } from "../lib/privateImport";
import "./item-information.css";

export function ItemDetailFields({
  values,
  onChange,
  activity,
}: {
  values: ItemPresentation;
  onChange: (value: ItemPresentation) => void;
  activity: boolean;
}) {
  return (
    <>
      {activity && (
        <label>
          Είδος πρότασης
          <select
            aria-label="Είδος πρότασης"
            value={values.kind}
            onChange={(e) => onChange({ ...values, kind: e.target.value })}
          >
            <option value="activity">Δραστηριότητα</option>
            <option value="place">Μέρος / τοποθεσία</option>
            <option value="food">Φαγητό / ποτό</option>
          </select>
        </label>
      )}
      <p className="field-help">
        Τα παρακάτω είναι προαιρετικά. Μπορείς να προτείνεις ένα μέρος ακόμα κι
        αν δεν υπάρχει στις στάσεις του ταξιδιού.
      </p>
      <div className="detail-fields">
        {DETAIL_FIELDS.map(([key, label, max]) => (
          <label key={key} className={max >= 2000 ? "full-field" : undefined}>
            {label}
            {max >= 3000 ? (
              <textarea
                rows={2}
                maxLength={max}
                value={values[key]}
                onChange={(e) => onChange({ ...values, [key]: e.target.value })}
              />
            ) : (
              <input
                type={key.endsWith("_url") ? "url" : "text"}
                maxLength={max}
                value={values[key]}
                onChange={(e) => onChange({ ...values, [key]: e.target.value })}
                placeholder={
                  key.endsWith("_url")
                    ? "https://…"
                    : key === "estimated_cost"
                      ? "π.χ. 15 EUR / άτομο · χρειάζεται επιβεβαίωση"
                      : undefined
                }
              />
            )}
          </label>
        ))}
      </div>
    </>
  );
}

function ItemPhoto({
  url,
  title,
  credit,
}: {
  url: string;
  title: string;
  credit: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return <p className="field-help">Η φωτογραφία δεν είναι διαθέσιμη.</p>;
  return (
    <figure className="item-photo">
      <img
        src={url}
        alt={title}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
      {credit && <figcaption>{credit}</figcaption>}
    </figure>
  );
}

export function ItemInformation({
  details,
  currency,
  title,
}: {
  details: Record<string, unknown>;
  currency: string;
  title: string;
}) {
  const values = getItemPresentation(details, currency);
  const sources = getItemSources(details);
  const image = safeImageUrl(values.image_url);
  const links = [
    ["website_url", "Πληροφορίες / κράτηση"],
    ["map_url", "Άνοιγμα χάρτη"],
  ] as const;
  const facts = DETAIL_FIELDS.filter(
    ([key]) => !key.endsWith("_url") && key !== "image_credit" && values[key],
  );
  return (
    <div className="item-information">
      {image && (
        <ItemPhoto
          key={image}
          url={image}
          title={title}
          credit={values.image_credit}
        />
      )}
      <div className="item-links">
        {links.map(([key, label]) => {
          const url = safeExternalUrl(values[key]);
          return (
            url && (
              <a
                className="button secondary compact"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                key={key}
              >
                {key === "map_url" ? (
                  <MapPin size={15} />
                ) : (
                  <ExternalLink size={15} />
                )}
                {label}
              </a>
            )
          );
        })}
      </div>
      {facts.length > 0 && (
        <dl className="item-facts">
          {facts.map(([key, label]) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>{values[key]}</dd>
            </div>
          ))}
        </dl>
      )}
      {sources.length > 0 && (
        <section className="item-sources">
          <h3>Πηγές & χρήσιμοι σύνδεσμοι</h3>
          <ul>
            {sources.map((source, index) => (
              <li key={`${source.url}-${index}`}>
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  {source.title}
                  <ExternalLink size={13} />
                </a>
                {source.checked && (
                  <span>Καταγεγραμμένος έλεγχος: {source.checked}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {!!details.legacy_record && (
        <p className="field-help">
          Οι πληροφορίες προέρχονται από το αρχικό αρχείο. Ώρες, τιμές και
          διαθεσιμότητα χρειάζονται επιβεβαίωση πριν την επίσκεψη.
        </p>
      )}
    </div>
  );
}
