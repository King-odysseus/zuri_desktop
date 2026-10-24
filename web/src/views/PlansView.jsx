import PlanCard from '../components/PlanCard.jsx';

/** Plan picker for a signed-in customer. */
export default function PlansView({ plans, currentPlan, busy, onChoose, onSignIn }) {
  return (
    <section className="view">
      <div className="view-head">
        <div>
          <h1>Plans</h1>
          <p>
            Choose a plan and pay with Paystack. Your new allowance starts as soon as the payment
            clears.
          </p>
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
              currentPlan={currentPlan}
              signedIn
              busy={busy === plan.code}
              onChoose={onChoose}
              onSignIn={onSignIn}
            />
          ))}
        </div>
      )}
    </section>
  );
}
