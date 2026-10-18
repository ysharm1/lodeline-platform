# How Lodeline makes money

This is the plain-language version. If you are new to Lodeline, read this first.
Every price below is set in one file: `src/services/pricing.ts`.

## The problem we solve

From 1 January 2027, DFARS 252.225-7052 looks at where magnet, tungsten and
tantalum material was mined, refined and separated, not only where it was
melted or produced. Small defense suppliers have to show which of those stages
their records cover. The records sit several tiers back, with suppliers who
are slow to answer.

## The core idea: collect once, reuse many times

One magnet maker may supply 30 US motor shops. Today each shop chases that
magnet maker for the same documents. If the magnet maker lets us keep its
reviewed documents on file, every later pack that involves it is faster for
the buyer and cheaper for us. Over time the documents on file become the
thing competitors can't copy.

This only works with the supplier's permission. That is why the upload page
asks for it (see "Supplier consent" below).

## Who pays for what

| # | What | Who pays | Price | Why it exists |
|---|---|---|---|---|
| 1 | Free parts audit | nobody | free | Gets buyers in the door. It is automated, so it costs us almost nothing. |
| 2 | Evidence pack | the buyer | Starter $2,500 · Standard $5,000 · Custom quoted | Our main revenue now. We chase supplier documents and build the per-part pack their prime will review. |
| 3 | Supplier verification | the supplier | $1,500 / $3,000 / $5,000 per year | Suppliers send their documents once and can point every customer to us. |
| 4 | Refresh plan | the buyer | $250/month (Starter) · $500/month (Standard) | Documents go stale and suppliers change. This turns one-time packs into recurring revenue. |
| 5 | Sourcing introductions | the buyer | flat fee, quoted | When a part has no documented source, we can introduce suppliers that do. Not built as a flow yet. |

### 1. Free parts audit

- The buyer uploads a parts list (CSV or Excel). No drawings.
- The system sorts each part into likely covered, possible, or likely not covered.
- The buyer sees which stages have no document behind them, and the price of the pack that would fix it.
- Our job after an audit: a 20-minute call to walk through the results.

### 2. Evidence pack (buyer pays)

The tier is set by the audit, so the buyer sees the price before paying.

| Tier | Price | Parts | Suppliers |
|---|---|---|---|
| Starter | $2,500 | up to 5 | up to 3 |
| Standard | $5,000 | up to 15 | up to 8 |
| Custom | quoted | more than 15 | more than 8 |

- "Parts" means parts the audit flagged (likely covered or possible).
- "Suppliers" means distinct supplier names behind those parts.
- The system won't let a buyer contact more suppliers than the tier covers. Revoking a link frees a slot.
- A custom-size list gets a **Request a quote** button instead of checkout.

### 3. Supplier verification (supplier pays)

| Facilities | Annual fee |
|---|---|
| 1 | $1,500 |
| 2 to 3 | $3,000 |
| 4 to 8 | $5,000 |
| more than 8 | quoted |

**The supplier pays for the review, not for passing.** This is the most
important rule in the business. It is built into the code:

- The fee is the same whatever the documents show.
- Paying never marks a listing as verified. Only accepted evidence does, in a separate step.
- A test fails if anyone changes the verification code to set "verified".
- Directory order depends only on search relevance and accepted evidence, never on who paid. A test checks this too.

### 4. Refresh plan (buyer pays monthly)

- Offered on every paid Starter or Standard pack.
- Monthly Stripe subscription. The buyer can cancel any time.
- We re-check the pack every 90 days: re-request expiring or missing documents, update the PDF.
- The admin "Refresh plans" page shows which packs are due.

### 5. Sourcing introductions (not built yet)

When a pack shows a stage with no documented source, the buyer often needs a
new supplier. We can introduce verified suppliers from the directory for a
flat fee the buyer pays.

**We do not take commissions from suppliers.** That is switched off in the
code (`SUPPLIER_COMMISSIONS_ENABLED = false`). Two reasons:

1. **Conflict of interest.** If a supplier pays us when a buyer switches to it,
   we earn more when we find gaps in the buyer's current suppliers. A prime's
   reviewer could reasonably doubt our packs.
2. **Legal risk.** A supplier paying us to steer a defense subcontract could
   raise questions under the federal Anti-Kickback Act. We are not lawyers.
   A government contracts attorney should review any referral structure before
   we turn it on.

## Supplier consent

On the supplier upload page there is a box called **Send these documents once**.

- It is **off** unless the supplier turns it on.
- To turn it on, the supplier types their name. We store the name and the time.
- The supplier can withdraw it on the same page, or by email.
- Without consent, documents collected for one buyer stay with that buyer.
- A directory listing can only be marked verified from documents the supplier
  allowed us to reuse, or from that supplier's own paid verification.

## What we tell buyers about how we are paid

Every pack page and every pack PDF carries this disclosure:

> How Lodeline is paid: buyers pay for evidence packs and refresh plans.
> Suppliers may pay a flat annual fee to have their own documents reviewed;
> that fee is the same whatever the review finds, and it never affects a
> pack's findings or a supplier's place in the directory. Lodeline does not
> take commissions from suppliers.

## Order of priorities

1. **Now to January 2027:** sell evidence packs. Goal: 3 to 5 paid packs.
2. **Q1 2027:** sign the first suppliers to paid verification. A supplier
   selling into US defense chains (for example, the Taiwan lead) is the best
   first customer for this.
3. **2027 onward:** convert finished packs into refresh plans.
4. **Later:** sourcing introductions, once a lawyer has reviewed the structure.

## Changing a price

1. Open `src/services/pricing.ts`.
2. Change the number. Prices are in US cents, so $2,500 is `250_000`.
3. Run `npm test`. The pricing tests will tell you which expectations to update.
4. Existing packs keep the price they were sold at. Only new orders change.

Lodeline provides supply-chain documentation and analysis, not legal advice or
government certification.
