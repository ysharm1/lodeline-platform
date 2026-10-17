/* Lodeline readiness check: deterministic scoring, no network, no storage.
 * Works in the browser (window.LodelineReadiness) and in Node (module.exports)
 * so tests/readiness.test.mjs can exercise every branch.
 *
 * Two independent results, never a percentage and never "compliant",
 * "exempt" or "certified":
 *   applicability: how many signals suggest DFARS 252.225-7052 may reach the parts
 *   documentation: how much written upstream evidence the supplier appears to have
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LodelineReadiness = api;
})(typeof self !== 'undefined' ? self : this, function () {
  var QUESTIONS = [
    { id: 'dod', dim: 'applicability',
      text: 'Do your products reach the Department of Defense, directly or through a prime or higher-tier supplier?',
      options: [['yes', 'Yes'], ['unsure', 'Not sure'], ['no', 'No']] },
    { id: 'material', dim: 'applicability',
      text: 'Do any of those products contain NdFeB or SmCo magnets, tungsten or tantalum (for example in motors, actuators or sensors)?',
      options: [['yes', 'Yes'], ['unsure', 'Not sure'], ['no', 'No']] },
    { id: 'asked', dim: 'applicability',
      text: 'Has a customer asked you about 252.225-7052 or the origin of magnets or these metals?',
      options: [['yes', 'Yes'], ['unsure', 'Not sure'], ['no', 'Not yet']] },
    { id: 'maker', dim: 'documentation',
      text: 'For the parts in question, do you know who made each magnet and in which country?',
      options: [['all', 'For all of them'], ['some', 'For some'], ['none', 'Not really']] },
    { id: 'upstream', dim: 'documentation',
      text: 'Do you have written records for the stages before the magnet maker (alloy and metal-making, separation, mining)?',
      options: [['all', 'For most parts'], ['some', 'For some parts'], ['none', 'No']] },
    { id: 'declaration', dim: 'documentation',
      text: 'Do your supplier declarations name each production stage and its country, rather than only the finished part?',
      options: [['all', 'Yes'], ['some', 'Some do, or not sure'], ['none', 'No']] }
  ];

  var APPLICABILITY = {
    strong: {
      label: 'Several applicability signals',
      text: 'Your answers suggest the clause may reach some of your parts. Whether it applies, and whether any exception is available, depends on the specific contract and the responsible reviewer.'
    },
    unclear: {
      label: 'Applicability unclear',
      text: 'Your answers leave open whether the clause reaches your parts. Confirming which contracts include it, and which parts contain covered material, is a sensible first step.'
    },
    few: {
      label: 'Few applicability signals',
      text: 'Your answers show few signs that the clause reaches your parts. That can change when a customer flows it down, so keep an eye on new purchase orders.'
    }
  };

  var DOCUMENTATION = {
    developed: {
      label: 'Documentation appears developed',
      text: 'You report written records for most stages. A stage-by-stage review can confirm what each document actually covers and where dates or details are missing.'
    },
    partial: {
      label: 'Partial documentation',
      text: 'You have some records, but upstream stages are usually where gaps appear. Listing which stage each document covers shows what to request next.'
    },
    gaps: {
      label: 'Significant documentation gaps',
      text: 'You report little written upstream evidence today. Starting with the parts your customers ask about most will show what to request from suppliers first.'
    }
  };

  var POINTS = { all: 2, some: 1, none: 0 };

  function validate(answers) {
    var missing = [];
    QUESTIONS.forEach(function (q) {
      var v = answers && answers[q.id];
      var ok = q.options.some(function (o) { return o[0] === v; });
      if (!ok) missing.push(q.id);
    });
    return missing;
  }

  function applicability(a) {
    // A customer asking outweighs a "no" elsewhere: the answers conflict, so say so.
    if (a.dod === 'no' || a.material === 'no') return a.asked === 'yes' ? 'unclear' : 'few';
    if (a.asked === 'yes') return 'strong';
    if (a.dod === 'yes' && a.material === 'yes') return 'strong';
    return 'unclear';
  }

  function documentation(a) {
    var score = POINTS[a.maker] + POINTS[a.upstream] + POINTS[a.declaration];
    if (a.upstream === 'none' || score <= 2) return 'gaps';
    if (score >= 5) return 'developed';
    return 'partial';
  }

  function evaluate(answers) {
    var missing = validate(answers);
    if (missing.length) return { complete: false, missing: missing };
    var ak = applicability(answers);
    var dk = documentation(answers);
    return {
      complete: true,
      applicability: { key: ak, label: APPLICABILITY[ak].label, text: APPLICABILITY[ak].text },
      documentation: { key: dk, label: DOCUMENTATION[dk].label, text: DOCUMENTATION[dk].text }
    };
  }

  return { QUESTIONS: QUESTIONS, evaluate: evaluate };
});
