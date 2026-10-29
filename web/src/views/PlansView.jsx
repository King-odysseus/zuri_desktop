import { useEffect, useState } from 'react';
import ImagePrices from '../components/ImagePrices.jsx';
import PlanCard from '../components/PlanCard.jsx';
import { fetchImagePrices } from '../lib/api.js';
import { planImageLines } from '../lib/format.js';

/** Plan picker for a signed-in customer. */
export default function PlansView({ plans, currentPlan, busy, onChoose, onSignIn, admin = false }) {
  const [imagePrices, setImagePrices] = useState([]);

  // Plans arrive as props from the shell, so this effect only fetches the image
  // catalogue. fetchImagePrices never rejects: a server without the endpoint
  // leaves this empty and the image section is simply not rendered, which keeps
  // this page exactly as it was before image prices existed.
  useEffect(() => {
    let cancelled = false;
    fetchImagePrices().then((prices) => {
      if (!cancelled) setImagePrices(prices);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="view calm calm-wide">
      <div className="view-head">
        <div>
          <h1>Plans</h1>
          {admin ? (
            <p>
              This is an administrator's account, so it pays for nothing. Put yourself on any plan,
              or put anyone else on one, in Admin, on the People list.
            </p>
          ) : (
            <p>
              Choose a plan and pay with Paystack. Your new allowance starts as soon as the payment
              clears.
            </p>
          )}
        </div>
      </div>
      {plans.length === 0 ? (
        <p className="empty">Plans could not be loaded. Reload the page to try again.</p>
      ) : (
        <div className="plan-grid">
          {plans.map((plan) => (
            <PlanCard
              key={plan.code}
              plan={plan}
              imageLines={planImageLines(plan.code, imagePrices, plans)}
              currentPlan={currentPlan}
              signedIn
              busy={busy === plan.code}
              onChoose={onChoose}
              onSignIn={onSignIn}
              admin={admin}
            />
          ))}
        </div>
      )}
      {imagePrices.length > 0 && (
        <section className="plan-images-section" id="images" style={{ marginTop: 22 }}>
          <h2>Pictures, priced in Naira</h2>
          <p>
            Images are paid for out of the same monthly allowance as your messages, so a picture
            never adds a second line to your bill.
          </p>
          <ImagePrices imagePrices={imagePrices} plans={plans} />
        </section>
      )}
    </section>
  );
}
