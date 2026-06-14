/**
 * Marketing cut — a ~60s montage of all 16 features, built from the rig's raw
 * per-scenario MP4s (demo/output/<id>.mp4). Each clip grabs the scenario's
 * *payoff tail* (the on-screen result), with a one-line caption; dull build-up
 * is either skipped (via the in/out slice) or sped up (via `rate`). Intro/outro
 * cards bookend it.
 *
 * Tuning: every `in`/`out` is in source-seconds and freely editable — re-run
 * `npm run demo:video:marketing` after any change (it recomposes from the
 * existing MP4s, no re-recording). compose() probes each segment's real
 * duration, so trimming a slice can't desync the crossfades.
 */
import { join } from "node:path";
import type { VideoEdl, ClipSegment } from "@mydemo/core";
import { DIRS, VIDEO } from "../config.ts";

const clip = (id: string, inS: number, outS: number, caption: string, rate = 1): ClipSegment => ({
  kind: "clip",
  source: join(DIRS.output, `${id}.mp4`),
  in: inS,
  out: outS,
  rate,
  caption,
});

const edl: VideoEdl = {
  id: "marketing",
  transition: 0.4,
  music: {
    // Drop a royalty-free track here (see DEMO.md › Music). Rendered silent if absent.
    file: join(VIDEO.musicDir, "marketing.mp3"),
    volume: 0.55,
    fadeIn: 1.5,
    fadeOut: 2.5,
  },
  segments: [
    { kind: "card", title: "myFinance", subtitle: "Your whole financial life — on your device.", duration: 2.6 },

    clip("01-basic-import", 8.4, 12.4, "Import Excel → instant net worth"),
    clip("02-credit-debit-import", 7.0, 10.7, "Cash-flow workbooks, auto-balanced"),
    clip("03-estate-readiness-import", 7.6, 11.3, "Emergency-ready accounts"),
    clip("04-multi-column-import", 7.6, 11.3, "One row → many accounts"),
    clip("05-wizard-fallback", 8.0, 11.8, "Any layout — guided import wizard"),
    clip("06-monthly-update", 7.6, 11.3, "One-tap monthly update"),
    clip("07-account-add-vault", 9.0, 18.5, "Encrypted credential vault", 2.5),
    clip("08-goal-with-eta", 3.4, 7.2, "Goals with a projected ETA"),
    clip("09-reminder-emergency", 1.9, 5.6, "Reminders for renewals & maturities"),
    clip("10-tax-itr-import", 4.5, 8.2, "Import your ITR — auto-parsed"),
    clip("11-fy-start-toggle", 5.5, 9.3, "Your financial year, your way"),
    clip("12-excel-export", 1.4, 5.1, "Export back to Excel anytime"),
    clip("13-fire-calculator", 14.0, 18.0, "Plan your FIRE number"),
    clip("14-people-insurance-gap", 11.0, 14.9, "Spot your insurance gap"),
    clip("15-health-ice-card", 4.0, 7.7, "Grab-and-go ICE medical card"),
    clip("16-estate-family-pack", 6.0, 9.8, "A plain-language family briefing"),

    { kind: "card", title: "Private. Offline. Yours.", subtitle: "No backend · no cloud · no tracking.", duration: 3.2 },
  ],
};

export default edl;
