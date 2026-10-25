import {
  formatNaira,
  formatTokens,
  highestPlanRank,
  imagePriceLine,
  planLabel,
  planRank,
} from '../lib/format.js';

/** "41 images" or "1 image": the count always carries its unit. */
function imagesLabel(images) {
  const count = Math.max(0, Math.floor(Number(images) || 0));
  return `${formatTokens(count)} ${count === 1 ? 'image' : 'images'}`;
}

/**
 * The picture models and what they cost, read straight from the server
 * catalogue: no rate or count is written into this file.
 *
 * Every card is a list item so the three models are announced as one group, and
 * each plan row names the plan in words rather than leaning on a colour. A
 * failed fetch leaves the caller with an empty list, which renders nothing at
 * all, so a page without image prices looks exactly as it did before.
 */
export default function ImagePrices({ imagePrices = [], plans = [] }) {
  const top = highestPlanRank(plans);

  const cards = (Array.isArray(imagePrices) ? imagePrices : [])
    .filter((model) => model && typeof model.name === 'string' && Array.isArray(model.plans))
    .map((model) => {
      const floor = planRank(model.minPlan);
      // A model with no known floor cannot be placed against the plans, so it is
      // left out rather than sold on a plan the server might refuse.
      if (floor === -1) return null;

      const rows = model.plans
        .filter((plan) => planRank(plan?.code) >= floor && Number(plan?.images) > 0)
        .sort((a, b) => planRank(a.code) - planRank(b.code));
      if (rows.length === 0) return null;

      // The headline is the price on the first plan that includes the model,
      // which is the one most visitors are looking at.
      const entry = rows.find((plan) => planRank(plan.code) === floor) ?? rows[0];
      const lowestPlan = planLabel(model.minPlan, plans);

      return {
        code: model.code ?? model.name,
        name: model.name,
        price: imagePriceLine(entry.priceKobo),
        entryPrice: Number(entry.priceKobo) || 0,
        included: floor === top ? `${lowestPlan} only` : `Included on ${lowestPlan} and above`,
        rows,
      };
    })
    .filter(Boolean);

  if (cards.length === 0) return null;

  return (
    <ul className="image-grid">
      {cards.map((card) => (
        <li className="card feature image-card" key={card.code}>
          <h3>{card.name}</h3>
          <p className="image-price">{card.price}</p>
          <p className="image-plans-note">{card.included}</p>
          <ul className="image-plan-list">
            {card.rows.map((row) => (
              <li className="image-plan-row" key={row.code}>
                <span className="image-plan-name">{planLabel(row.code, plans)}</span>
                <span className="image-plan-count">
                  about {imagesLabel(row.images)} a month
                  {Number(row.priceKobo) === card.entryPrice
                    ? ''
                    : ` at ${formatNaira(row.priceKobo)} each`}
                </span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
