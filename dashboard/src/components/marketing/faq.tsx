import { FAQ } from "./faq-data";
import { Reveal } from "./reveal";

/** Native <details>: works without JavaScript, is keyboard accessible, and every answer is in the HTML for crawlers. */
export function Faq() {
  return (
    <div className="divide-y rounded-2xl border bg-card">
      {FAQ.map((item, i) => (
        <Reveal key={item.q} delay={Math.min(i, 4) * 0.04}>
          <details className="group px-6 py-5 open:pb-6" name="faq">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-medium marker:hidden [&::-webkit-details-marker]:hidden">
              <h3 className="font-sans text-base font-semibold md:text-lg">{item.q}</h3>
              <span aria-hidden className="text-2xl leading-none text-primary transition-transform duration-300 group-open:rotate-45">+</span>
            </summary>
            <p className="mt-3 leading-relaxed text-muted-foreground">{item.a}</p>
          </details>
        </Reveal>
      ))}
    </div>
  );
}
