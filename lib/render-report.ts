import {
  ReportParts,
  Meeting,
  ReportContext,
  Secretary,
} from "./report-generation";
import constants from "../constants";
import { capitalizeFirstLetter, formatDate } from "./utils";
import * as fs from "fs";
import VRNotulenName from "./vr-notulen-name";
import VRDocumentName from "./vr-document-name";

function createStyleHeader() {
  const styles = fs.readFileSync("/app/style/report-style.css").toString();

  return `
<head>
  <style>
    ${styles}
  </style>
</head>`;
}

function meetingKindTitle(meeting: Meeting) {
  const formattedDate = formatDate(meeting.plannedStart);
  const {
    MINISTERRAAD,
    ELEKTRONISCHE_PROCEDURE,
    BIJZONDERE_MINISTERRAAD,
    PVV,
    ANNEX,
  } = constants.MEETING_KINDS;
  let meetingKindTitle: string;
  const meetingKind = meeting.mainMeetingKind || meeting.kind;
  switch (meetingKind) {
    case MINISTERRAAD:
      meetingKindTitle = `Vergadering van ${formattedDate}`;
      break;
    case ELEKTRONISCHE_PROCEDURE:
      meetingKindTitle = `Elektronische vergadering van ${formattedDate}`;
      break;
    case BIJZONDERE_MINISTERRAAD:
      meetingKindTitle = `Bijzondere vergadering van ${formattedDate}`;
      break;
    case PVV:
      throw new Error(`Hoofdvergadering kan geen Plan Vlaamse Veerkracht zijn`);
    case ANNEX:
    default:
      throw new Error(`Unknown meeting kind: ${meeting.kind}`);
  }
  if (meeting.kind === PVV) {
    meetingKindTitle += `<br />Plan Vlaamse Veerkracht`;
  }
  return meetingKindTitle;
}

export function generateConcernsPart(
  agendaitemShortTitle: string,
  agendaitemTitle: string | null,
  agendaitemIsApproval: boolean,
  documents: string[],
  subcaseName: string | null,
  agendaitemType: string
): string {
  const isNota = agendaitemType === constants.AGENDA_ITEM_TYPES.NOTA;
  let betreft = "";
  betreft += `${agendaitemShortTitle}`;
  betreft += agendaitemTitle ? `<br/>${agendaitemTitle}` : "";
  betreft += (isNota && subcaseName) ? `<br/>${capitalizeFirstLetter(subcaseName)}` : "";
  betreft +=
    documents && documents.length
      ? `<br/>${formatDocuments(documents, agendaitemIsApproval)}`
      : "";

  // wrap with div and p to match watch rdfa editor would have done.
  // pdf looks different without the wrapping, no break after this section
  return `<div><p>${betreft.replace(/\n/g, '<br />')}</p></div>`;
}

function formatDocuments(documents: string[], isApproval: boolean) {
  const simplifiedNames: any[] = [];
  let previousVrModel: VRDocumentName | null = null;
  for (const pieceName of documents) {
    if (isApproval) {
      try {
        simplifiedNames.push(new VRNotulenName(pieceName).vrNumberWithSuffix());
      } catch {
        simplifiedNames.push(pieceName);
      }
      continue;
    }
    try {
      const vrModel = new VRDocumentName(pieceName);
      const vrDateOnly = vrModel.vrDateOnly();
      // if the date part of the previous VR number is the same we don't repeat it
      const previousVrDate = previousVrModel?.vrDateOnly();
      if (previousVrDate === vrDateOnly) {
        simplifiedNames.push(vrModel.withoutDate());
      } else {
        simplifiedNames.push(vrModel.vrNumberWithSuffix());
      }
      previousVrModel = vrModel;
    } catch {
      simplifiedNames.push(pieceName);
      previousVrModel = null;
      continue;
    }
  }
  return `(${formatListNl(simplifiedNames)})`;
}

function formatListNl(items: string[]): string {
  if (items.length === 0) {
    return '';
  } else if (items.length === 1) {
    return items[0];
  } else {
    return `${items.slice(0, -1).join(", ")} en ${
      items[items.length - 1]
    }`;
  }
}

function generateReportContent(
  reportParts: ReportParts,
  reportContext: ReportContext,
  secretary: Secretary | null
) {
  const { meeting, currentReportName } = reportContext;
  let annotationHtml = `<br />
  <br />`;
  if (reportParts.annotation) {
    annotationHtml = `<p class="annotation">${reportParts.annotation}</p>
    <br />`;
  }
  let confidentialHtml = "";
  if (reportContext.accessLevel === constants.ACCESS_LEVELS.VERTROUWELIJK) {
    confidentialHtml = '<p class="confidential-statement">VERTROUWELIJK</p>';
  }
  let reportHtml = `
  <div lang="nl">
    <div>
      <div style="text-align: center;">
        <br />
        <svg
          class="logo"
          viewBox="0 0 141.8 65.2"
          width="141.8"
          height="65.2"
          xmlns="http://www.w3.org/2000/svg"
        >
          <style>
            .st0 {
              fill: #373636;
            }
          </style>
          <path
            class="st0"
            d="m68.842 13.341-5 14.4h-2.9l-5-14.4h2.7l3.8 11 3.7-11z"
          />
          <path class="st0" d="m71.142 12.141 2.2-.2h.4v15.6h-2.6z" />
          <path
            class="st0"
            d="M85.542 27.741c-.4 0-.8-.1-1.3-.2-.4-.2-.8-.5-1.3-.9-.4.3-.8.6-1.3.8-.5.2-1 .3-1.7.3-.5 0-1.1-.1-1.6-.3-.6-.2-1.1-.5-1.4-1-.4-.5-.6-1.3-.6-2.3 0-1 .2-1.8.8-2.3.6-.5 1.6-.8 3.1-.8.6 0 1.3 0 2.3.1v-.6c0-.8-.2-1.3-.6-1.6-.4-.3-.9-.5-1.5-.5-.5 0-1 .1-1.5.2s-1 .3-1.5.5l-.6-2.2c1.2-.6 2.7-.9 4.1-.9 1.1 0 2.1.2 2.9.8.8.6 1.2 1.5 1.2 2.9v4.2c0 .5.2.9.5 1.2.3.3.7.4 1.2.5l-1.2 2.1Zm-3-4.7c-1.2 0-2.1 0-2.7.1-.6.1-1 .5-1 1.1 0 .9.7 1.4 1.6 1.4.3 0 .8-.1 1.3-.3.5-.3.8-.8.8-1.7v-.6Z"
          />
          <path
            class="st0"
            d="M97.242 27.741c-.4 0-.8-.1-1.2-.2-.4-.2-.8-.5-1.3-.9-.4.3-.8.6-1.3.8-.5.2-1 .3-1.7.3-.5 0-1.1-.1-1.6-.3-.6-.2-1.1-.5-1.4-1-.4-.5-.6-1.3-.6-2.3 0-1 .2-1.8.8-2.3.6-.5 1.6-.8 3.1-.8.6 0 1.3 0 2.3.1v-.6c0-.8-.2-1.3-.6-1.6-.4-.3-.9-.5-1.5-.5-.5 0-1 .1-1.5.2s-1 .3-1.5.5l-.6-2.2c1.2-.6 2.7-.9 4.1-.9 1.1 0 2.1.2 2.9.8.8.6 1.2 1.5 1.2 2.9v4.2c0 .5.2.9.5 1.2.3.3.7.4 1.2.5l-1.3 2.1Zm-3-4.7c-1.2 0-2.1 0-2.7.1-.6.1-1 .5-1 1.1 0 .9.7 1.4 1.6 1.4.3 0 .8-.1 1.3-.3.5-.3.8-.8.8-1.7v-.6Z"
          />
          <path
            class="st0"
            d="M100.442 16.341h2.1l.2.8c.9-.6 1.9-1 3-1s2.1.4 2.7 1.3c1-.9 2.2-1.3 3.4-1.3.9 0 1.8.3 2.5.9.6.6 1.1 1.6 1.1 3v7.4h-2.5v-6.7c0-.8-.2-1.4-.6-1.7-.4-.3-.8-.5-1.3-.5-.6 0-1.3.2-1.9.6 0 .3.1.6.1.9v7.5h-2.5v-6.7c0-.8-.2-1.4-.5-1.7-.3-.3-.8-.5-1.3-.5-.6 0-1.3.2-1.9.6v8.3h-2.5v-11.2Z"
          />
          <path
            class="st0"
            d="M117.742 24.641c.4.1.8.3 1.3.5s1 .3 1.5.3c.4 0 .9-.1 1.3-.3.3-.2.6-.5.6-1s-.3-.9-.7-1.1c-.2-.1-.5-.2-.8-.3-.6-.2-1.2-.4-1.7-.6-.6-.3-1-.7-1.3-1.3-.1-.3-.2-.7-.2-1.2 0-1.2.5-2 1.2-2.6.7-.5 1.7-.8 2.7-.8.9 0 1.8.2 2.5.4v2.3l-.1.1c-.6-.3-1.2-.5-1.9-.5-.5 0-.9.1-1.2.2-.3.2-.5.4-.5.8s.3.6.7.9c.2.1.5.2.7.3.6.2 1.1.4 1.7.7.6.3 1 .8 1.3 1.5.1.3.2.8.2 1.2 0 1.3-.5 2.2-1.3 2.8-.8.6-1.9.9-3 .9s-2.1-.3-2.9-.8v-2.4Z"
          />
          <path
            class="st0"
            d="M135.842 24.641v2.4c-.5.2-1 .4-1.6.5-.6.1-1.1.2-1.6.2-1.6 0-3-.5-4-1.4-1.1-1-1.7-2.4-1.7-4.4 0-1.9.6-3.3 1.6-4.3.9-1 2.2-1.5 3.5-1.5.4 0 1 0 1.6.3.7.2 1.4.7 1.9 1.4s.9 1.8.9 3.4v1.7h-6.8c.2.9.7 1.5 1.3 1.9.6.4 1.3.6 2 .6 1-.1 2-.4 2.9-.8Zm-1.7-3.7c-.1-.8-.3-1.4-.7-1.8-.4-.4-.9-.5-1.4-.5-.5 0-1 .2-1.5.5-.4.4-.8 1-.9 1.8h4.5Z"
          />
          <path
            class="st0"
            d="M57.142 48.241v-14.2h4.1c.9 0 2 .1 2.9.4.9.3 1.8.8 2.4 1.6.6.8 1 1.8 1 3.1 0 1-.2 1.8-.7 2.5-.4.7-1 1.2-1.8 1.6.3.6.9 1.4 1.5 2 .7.7 1.4 1.2 2.1 1.4v.1l-1.1 1.7c-.7 0-1.4-.3-2.1-.8-.7-.5-1.3-1.1-1.8-1.8s-.9-1.4-1.1-1.9c-.5.1-.9.1-1.4.1h-1.6v4.2h-2.4Zm2.5-11.8v5.1h1.6c1.5 0 2.4-.2 3-.7.6-.4.8-1 .8-1.8s-.2-1.4-.8-1.9c-.6-.5-1.5-.7-3-.7h-1.6Z"
          />
          <path
            class="st0"
            d="M79.342 45.341v2.4c-.5.2-1 .4-1.6.5-.6.1-1.1.2-1.6.2-1.6 0-3-.5-4-1.4-1.1-1-1.7-2.4-1.7-4.4 0-1.9.6-3.3 1.6-4.3.9-1 2.2-1.5 3.5-1.5.4 0 1 0 1.6.3.7.2 1.4.7 1.9 1.4s.9 1.8.9 3.4v1.7h-6.8c.2.9.7 1.5 1.3 1.9.6.4 1.3.6 2 .6.9-.1 1.9-.4 2.9-.8Zm-1.8-3.8c-.1-.8-.3-1.4-.7-1.8-.4-.4-.9-.5-1.4-.5-.5 0-1 .2-1.5.6-.4.4-.8 1-.9 1.8h4.5Z"
          />
          <path
            class="st0"
            d="m91.942 38.141-.1.2c-.6.1-1.2.3-1.9.7.2.4.3.9.3 1.4 0 1.1-.4 2-1.2 2.8-.7.7-1.8 1.2-3 1.2-.5 0-.9-.1-1.3-.2-.2.2-.2.4-.2.6 0 .5.5.8 1.3.8h1.3c1.5 0 2.7.4 3.4 1 .7.6 1.1 1.5 1.1 2.4 0 1.2-.7 2.3-1.8 3.1-1.1.8-2.5 1.3-3.9 1.3-1.3 0-2.3-.4-3-1-.7-.6-1.1-1.5-1.1-2.5 0-.9.5-2 1.3-2.8-.3-.2-.5-.5-.7-.8-.2-.3-.2-.7-.2-1 0-.6.3-1.3.8-2-.3-.3-.5-.7-.7-1.2-.2-.5-.2-1-.2-1.4 0-1.1.4-2 1.2-2.7.7-.7 1.8-1.1 3-1.1.8 0 1.6.2 2.2.5.5-.4 1-.6 1.5-.8.5-.2 1-.3 1.3-.3l.6 1.8Zm-6.9 9.7c-.4.5-.7 1-.7 1.5 0 .4.2.8.5 1.1.3.3.9.4 1.5.4.8 0 1.4-.2 1.9-.6.5-.3.8-.8.8-1.2 0-.6-.3-.9-.8-1.1-.5-.2-1.2-.2-2-.2h-1.2Zm1.1-8.8c-.6 0-1 .2-1.3.5-.3.3-.5.7-.5 1.1 0 .4.2.8.5 1.1.3.3.7.5 1.3.5.6 0 1-.2 1.3-.5.3-.3.4-.7.4-1.1 0-.4-.1-.8-.4-1.1-.3-.3-.7-.5-1.3-.5"
          />
          <path
            class="st0"
            d="M101.442 45.341v2.4c-.5.2-1 .4-1.6.5-.6.1-1.1.2-1.6.2-1.6 0-3-.5-4-1.4-1.1-1-1.7-2.4-1.7-4.4 0-1.9.6-3.3 1.6-4.3.9-1 2.2-1.5 3.5-1.5.4 0 1 0 1.6.3.7.2 1.4.7 1.9 1.4s.9 1.8.9 3.4v1.7h-6.8c.2.9.7 1.5 1.3 1.9.6.4 1.3.6 2 .6.9-.1 1.9-.4 2.9-.8Zm-1.7-3.8c-.1-.8-.3-1.4-.7-1.8-.4-.4-.9-.5-1.4-.5-.5 0-1 .2-1.5.6-.4.4-.8 1-.9 1.8h4.5Z"
          />
          <path
            class="st0"
            d="M111.142 39.841c-.6-.4-1.3-.6-1.9-.6-.8 0-1.6.3-2.3.8v8.1h-2.5v-11.2h2.1l.3.9c.8-.7 1.7-1.1 2.8-1.1.3 0 .7 0 1.1.1.4.1.8.2 1.1.3l-.7 2.7Z"
          />
          <path
            class="st0"
            d="M113.642 34.041c0-.4.2-.8.4-1 .3-.3.6-.4 1.1-.4.5 0 .8.2 1.1.4.3.3.4.6.4 1s-.2.8-.4 1c-.3.3-.6.4-1.1.4-.5 0-.8-.2-1.1-.4-.3-.2-.4-.5-.4-1m.2 3h2.5v11.2h-2.5v-11.2Z"
          />
          <path
            class="st0"
            d="M119.342 37.041h2.1l.2.9c1-.7 2.3-1.1 3.6-1.1 1.1 0 2.1.3 2.8.9.7.6 1.2 1.6 1.2 3v7.4h-2.5v-6.7c0-.8-.3-1.4-.8-1.8-.5-.4-1.1-.5-1.8-.5-.9 0-1.7.3-2.4.7v8.3h-2.5v-11.1Z"
          />
          <path
            class="st0"
            d="m141.842 38.141-.1.2c-.6.1-1.2.3-1.9.7.2.4.3.9.3 1.4 0 1.1-.4 2-1.2 2.8-.7.7-1.8 1.2-3 1.2-.5 0-.9-.1-1.3-.2-.2.2-.2.4-.2.6 0 .5.5.8 1.2.8h1.3c1.5 0 2.7.4 3.4 1 .7.6 1.1 1.5 1.1 2.4 0 1.2-.7 2.3-1.8 3.1-1.1.8-2.5 1.3-3.9 1.3-1.3 0-2.3-.4-3-1-.7-.6-1.1-1.5-1.1-2.5 0-.9.5-2 1.3-2.8-.3-.2-.5-.5-.7-.8-.2-.3-.2-.7-.2-1 0-.6.3-1.3.8-2-.3-.3-.5-.7-.7-1.2-.1-.5-.2-1-.2-1.4 0-1.1.4-2 1.2-2.7.7-.7 1.8-1.1 3-1.1.8 0 1.6.2 2.2.5.5-.4 1-.6 1.5-.8.5-.2 1-.3 1.3-.3l.7 1.8Zm-6.9 9.7c-.4.5-.7 1-.7 1.5 0 .4.2.8.5 1.1.3.3.9.4 1.5.4.8 0 1.4-.2 1.9-.6.5-.3.8-.8.8-1.2 0-.6-.3-.9-.8-1.1-.5-.2-1.2-.2-2-.2h-1.2Zm1.1-8.8c-.6 0-1 .2-1.3.5-.3.3-.5.7-.5 1.1 0 .4.2.8.5 1.1.3.3.7.5 1.3.5.6 0 1-.2 1.3-.5.3-.3.4-.7.4-1.1 0-.4-.1-.8-.4-1.1-.3-.3-.7-.5-1.3-.5"
          />
          <path class="st0" d="M29.09.098 29.372 0 51.93 65.104l-.284.098z" />
          <path
            class="st0"
            d="M30.042 31.841c-1.7-1.3-2.4 0-3.5-.1-.9-.1-1.7-1.5-2.4-1.2-1.3.7.5 3 1.3 3.5.7.4 1.6.8 1.8.9 1.1.5 1.5 1.2 1.6 2.4 0 .3 0 .9-.1 1.2-.5 2-4 3.9-6.1 2.5-1-.7-1.8-1.5-2.2-3-.6-2.7-2.5-4.6-3.1-7.3-.4-1.6-.7-3.3-1.1-4.9-.4-1.7-.9-3.3-1.2-4.8-.3-1.4-1-3.5-1.5-4.8-2-5.1-2.8-4.7-2.8-4.7s.7 1.4 3.3 13.9c.1.5 1 6 1.7 7.8.2.7.7 2 1 2.7.8 1.8 3 4.5 3.1 7 .1 1.4.2 2.6.3 3.7 0 .3.2 1.6.4 2.2.5 1.5 4.8 6.3 9.4 6.3v-3.7c-4.5 0-8.8-2.5-8.9-2.8-.1-.1.2-1.8.5-2.6.6-1.5 1.7-2.8 3.7-3 2.2-.2 3.5.5 4.7.5l.1-11.7Z"
          />
          <path
            class="st0"
            d="M10.442 18.541c-.2 2.7-4.4 6.5-5.7 8.9-.7 1.2-1.4 3.2-1.7 4.4-.6 3.3.2 5.3.9 7.2 1.4 3.4-.2 4.6.9 3.9 1.4-1.1 1.2-3.7 1-5.3-.1-1.3-.2-2.8 0-4.3.4-2.9 2.1-6 3.6-8.2 2-2.7 1.3-5.4 1-6.6"
          />
          <path
            class="st0"
            d="M11.242 26.341s.5 2.2-1.5 7.7c-5 14.6 4.6 16 7.3 19.4 0 0 1.1-1.5-3.3-6.2-1.6-1.7-3-5.6-1.8-11 1.9-8-.7-9.9-.7-9.9"
          />
          <path
            class="st0"
            d="M1.842 16.741c-.2-.9-.3-1.6-.2-2.3.2-3.4 3.3-4.8 4.1-5.3 0 0 1.4-1 1.6-1.9 0 0 1.4 3.6-1.9 5.7-1.7 1-2.8 2.2-3.6 3.8"
          />
          <path
            class="st0"
            d="M9.642 13.441c.2.3 1.5 2.2-3.8 6.6-5.3 4.4-3.6 7.5-3.6 7.5s-5.6-3.1.9-8.5 5.2-6.5 5.2-6.5.8-.1 1.3.9"
          />
          <path
            class="st0"
            d="M16.542 15.141c.9.1 1.5 3 3.6 3.6 1.6.5 3.2.2 3.6 1.1-.7.4-.1 1.6.6 1.4.5-1.6.8-8.1-7.8-6.1m2.8 1.3c.1-.2.2 0 .4-.2s.5-.6.9-.7c.3-.1.7 0 .9.1.2 0 .1.5-.1.6-.3.2-1.1-.1-1.1.5 0 1 1.4 0 2.1 0 .5 2.4-3.7 1.7-3.1-.3"
          />
        </svg>
        <p style="font-size: 12pt;">${meetingKindTitle(meeting)}</p>
        <p>________________________________________</p>
      </div>
      ${confidentialHtml}
      ${annotationHtml}
      <p
        style="font-weight: 500; text-decoration: underline; font-size: 12pt;"
      >
        ${currentReportName}
      </p>
      <br />

      <p>
        <span class="part-title">Betreft</span>
        :
      </p>
      ${reportParts.concerns}
      <br />

      <p>
        <span class="part-title">Beslissing</span>
        :
      </p>
      ${reportParts.decision}
    </div>
    ${
      secretary && secretary.person
        ? `<div class="signature-container">
            <div>
              <p style="font-weight: 500;">
                ${secretary.person.firstName}
                ${secretary.person.lastName.toUpperCase()},
              </p>
              <p>${secretary.title}.</p>
            </div>
          </div>`
        : ""
    }
  </div>
  `;
  return reportHtml;
}

export function generateReportHtml(
  reportParts: ReportParts,
  reportContext: ReportContext,
  secretary: Secretary | null
): string {
  return `
${createStyleHeader()}
${generateReportContent(reportParts, reportContext, secretary)}`;
}
