// A streaming CSV reader for the govspending bulk export — 4.7 GB of CSV per
// fiscal year, so it is read as it inflates, a chunk at a time, never whole.
//
// Hand-written because the project adds no npm packages. RFC 4180: quoted
// fields, "" as an escaped quote, commas and newlines inside quotes, CRLF or
// LF line ends, and a leading UTF-8 BOM. A chunk can end anywhere — mid-field,
// mid-quote, between the "" of an escape, or between \r and \n — so all parser
// state lives across chunks.
//
// Measured against the real FY2569 export, not the RFC: project names carry
// bare quotes mid-field (…CAMPAIGN "…"). A quote therefore opens a quoted
// field ONLY at the start of a field, as Python's csv module reads it. The
// first version treated any quote as an opener and silently merged ~70% of
// 2569-egp-contract-1.csv into its neighbours (143k rows instead of 515k).

// Everything that can end or change a field outside quotes.
const SPECIAL = /[,\r\n"]/g;

export async function* parseCsv(chunks: AsyncIterable<string>): AsyncIterable<string[]> {
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // A quote seen inside a quoted field: either an escape ("") or the close,
  // which is only known from the NEXT character — possibly in the next chunk.
  let quotePending = false;
  let skipLf = false;
  let atFieldStart = true;
  let first = true;

  // Copies runs of ordinary text as slices, jumping between special characters
  // with a regex / indexOf. The first version appended one character at a
  // time and spent ~60% of a full-year scan here.
  for await (let chunk of chunks) {
    if (first) {
      if (chunk.charCodeAt(0) === 0xfeff) chunk = chunk.slice(1);
      first = false;
    }

    const len = chunk.length;
    let i = 0;

    while (i < len) {
      if (skipLf) {
        skipLf = false;
        if (chunk.charCodeAt(i) === 10) {
          i++;
          continue;
        }
      }

      if (quotePending) {
        quotePending = false;
        if (chunk.charCodeAt(i) === 34) {
          field += '"';
          i++;
          continue;
        }
        inQuotes = false; // that quote closed the field; read on unquoted
      }

      if (inQuotes) {
        const q = chunk.indexOf('"', i);
        if (q === -1) {
          field += chunk.slice(i);
          break;
        }
        field += chunk.slice(i, q);
        quotePending = true;
        i = q + 1;
        continue;
      }

      SPECIAL.lastIndex = i;
      const m = SPECIAL.exec(chunk);
      const j = m ? m.index : len;
      if (j > i) {
        field += chunk.slice(i, j);
        atFieldStart = false;
      }
      if (!m) break;

      const c = chunk[j];
      i = j + 1;

      if (c === '"') {
        if (atFieldStart) {
          inQuotes = true;
          atFieldStart = false;
        } else {
          field += '"'; // a bare quote mid-field is text
        }
      } else if (c === ",") {
        row.push(field);
        field = "";
        atFieldStart = true;
      } else {
        row.push(field);
        field = "";
        yield row;
        row = [];
        skipLf = c === "\r";
        atFieldStart = true;
      }
    }
  }

  // A file that doesn't end in a newline still has a last row.
  if (field !== "" || row.length > 0) {
    row.push(field);
    yield row;
  }
}

/**
 * Header row + data rows → objects keyed by header name. Blank lines are dropped.
 *
 * Repairs rows split by a raw line break inside an unquoted field — six in
 * 2569-egp-contract-1.csv arrive as a 6-value row then a 23-value row. When a
 * short row and the next one together make exactly the header's width (the
 * split field counted once), they are one record and are stitched back. A
 * short row that can't be completed is kept, padded, rather than dropped.
 */
export async function* csvRecords(chunks: AsyncIterable<string>): AsyncIterable<Record<string, string>> {
  let header: string[] | null = null;
  let pending: string[] | null = null;

  const toRecord = (row: string[]) => {
    const record: Record<string, string> = {};
    header!.forEach((name, i) => {
      record[name] = row[i] ?? "";
    });
    return record;
  };

  for await (const row of parseCsv(chunks)) {
    if (row.length === 1 && row[0] === "") continue;
    if (!header) {
      header = row.map((h) => h.trim());
      continue;
    }
    const width = header.length;

    if (pending) {
      const merged: string[] = [...pending.slice(0, -1), `${pending.at(-1)}\n${row[0]}`, ...row.slice(1)];
      if (merged.length <= width) {
        if (merged.length === width) {
          yield toRecord(merged);
          pending = null;
        } else {
          pending = merged; // split more than once
        }
        continue;
      }
      // The next row doesn't continue it — it's a record of its own.
      yield toRecord(pending);
      pending = null;
    }

    if (row.length < width) pending = row;
    else yield toRecord(row);
  }

  if (pending) yield toRecord(pending);
}
