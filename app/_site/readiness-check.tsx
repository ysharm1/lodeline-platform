"use client";
/**
 * The 6-question readiness check. Answers stay in React state on this page:
 * nothing is sent, stored, or written to the URL. There is no submit button,
 * so the form can never be submitted natively either.
 */
import { useRef, useState } from "react";
import { evaluate, QUESTIONS, type Answers, type ReadinessResult } from "@/services/readiness";

export function ReadinessCheck() {
  const [answers, setAnswers] = useState<Answers>({});
  const [result, setResult] = useState<ReadinessResult | null>(null);
  const out = useRef<HTMLDivElement>(null);
  const answered = Object.keys(answers).length;

  return (
    <form className="quiz glass" id="quiz" noValidate onSubmit={(e) => e.preventDefault()}>
      <div className="q-prog" aria-hidden="true">
        <i id="q-fill" style={{ width: `${(answered / QUESTIONS.length) * 100}%` }} />
      </div>
      <div id="quiz-qs">
        {QUESTIONS.map((q, i) => (
          <fieldset key={q.id}>
            <legend>
              <span className="q-n">
                {i + 1} / {QUESTIONS.length}
              </span>{" "}
              {q.text}
            </legend>
            {q.options.map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name={q.id}
                  value={value}
                  checked={answers[q.id] === value}
                  onChange={() => setAnswers((a) => ({ ...a, [q.id]: value }))}
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      <button
        className="btn btn-lg"
        type="button"
        id="quiz-go"
        onClick={() => {
          setResult(evaluate(answers));
          setTimeout(() => out.current?.focus(), 0);
        }}
      >
        See my result
      </button>
      <div className="quiz-out" id="quiz-out" hidden={!result} tabIndex={-1} aria-live="polite" ref={out}>
        {result && !result.complete ? (
          <p>
            Please answer all {QUESTIONS.length} questions ({result.missing.length} left).
          </p>
        ) : null}
        {result && result.complete ? (
          <>
            <div className="result-grid">
              <div className={`result r-app-${result.applicability.key}`}>
                <span className="mono-lbl">Applicability</span>
                <h3>{result.applicability.label}</h3>
                <p>{result.applicability.text}</p>
              </div>
              <div className={`result r-doc-${result.documentation.key}`}>
                <span className="mono-lbl">Documentation</span>
                <h3>{result.documentation.label}</h3>
                <p>{result.documentation.text}</p>
              </div>
            </div>
            <p className="fine">
              This is a general indication from your own answers, not a determination of whether the clause applies or whether any part is
              acceptable.
            </p>
            <p style={{ marginTop: 16 }}>
              <a className="btn" href="#contact">
                Request a readiness call
              </a>
            </p>
          </>
        ) : null}
      </div>
    </form>
  );
}
