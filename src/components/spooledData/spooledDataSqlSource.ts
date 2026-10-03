/**
 * Generates SQL DDL for the UDTF from embedded source SQL.
 *
 * Source origin: /Users/cozzi/Downloads/projects/open-UDTF/src/SPOOLED_DATA/SPOOL_DATA.SQL
 */
import { applySqlSourceTokens } from '../sqlSourceTokens';

const SQL_TEMPLATE = String.raw`
 -- SPDX-License-Identifier: Apache-2.0
 -- Copyright (c) 1996-2026 by R. Cozzi, Jr.
 -- @author BobCozzi

-- Read SPOOLED File Data directly (no CPYSPLF output file)
--
-- Source origin:
--     /Users/cozzi/Downloads/projects/open-UDTF/src/SPOOLED_DATA/SPOOL_DATA

-- SPOOLED_DATA UDTF

CREATE OR REPLACE FUNCTION sqltools.SPOOLED_DATA(
    SPLFNAME  VARCHAR(10)  DEFAULT '*LAST',
    SPLNBR    VARCHAR(6)   DEFAULT '*LAST',
    JOB_NAME  VARCHAR(28)  DEFAULT '*',
    BLANK_LINES  VARCHAR(10)  DEFAULT '*DROP',
    EOF          VARCHAR(10)  DEFAULT '*IGNORE',

    START_PAGE   VARCHAR(16)  DEFAULT '1',
    START_LINE   INT          DEFAULT 1,

    INT_JOBID  BINARY(16)   DEFAULT NULL,
    INT_SPLFID BINARY(16)   DEFAULT NULL,
    OPTIONS    VARCHAR(255)  DEFAULT NULL,

    SPOOLED_FILE_NAME
                  VARCHAR(10)  DEFAULT NULL,
    SPOOLED_FILE_NUMBER
                  VARCHAR(6)   DEFAULT NULL
   )

  RETURNS TABLE (
      SPLFNAME         VARCHAR(10),
      SPLNBR           INT,
      ORDINAL_POSITION INT,

      PAGENBR          INT,
      LINENBR          INT,
      SPOOLED_DATA     VARCHAR(2048)
                           FOR MIXED DATA,

      PAGE_COUNT       INT,
      PAGE_LENGTH      SMALLINT,
      PAGE_WIDTH       SMALLINT,

      CRTSYSNAME       VARCHAR(8),
      ORGSYSNAME       VARCHAR(8),

      JOB              VARCHAR(28),
   -- Same as SPOOLED_DATA but with "FOR BIT DATA"
   -- this allows it to pass thru unmodified if needed.
      SPOOLED_DATA_BIN VARCHAR(2048)
                           FOR BIT DATA
   )

    LANGUAGE C++
    NO  SQL
    NO  FINAL CALL
    NOT DETERMINISTIC
    NOT FENCED
    DISALLOW PARALLEL
    SCRATCHPAD 6000
    SPECIFIC sqltools.SPOOLED_DATA
    EXTERNAL NAME 'SQLTOOLS/SPOOL_DATA'
    PARAMETER STYLE DB2SQL;


LABEL ON SPECIFIC ROUTINE sqltools.SPOOLED_DATA
    IS 'Read SPOOLED file data (standalone)';

COMMENT ON SPECIFIC FUNCTION sqltools.SPOOLED_DATA
  IS 'Read SPOOLED file data as text.
 Standalone UDTF - no SQLTOOLS *SRVPGM required.
 The *SCS SPOOLED file is read directly and each
 line is returned as a row. Blank lines are omitted
 by default to mimic the DSPSPLF viewer window.';

COMMENT ON PARAMETER SPECIFIC FUNCTION
    sqltools.SPOOLED_DATA
(
SPLFNAME IS 'SPOOLED File Name. Specify any valid
 SPOOLED file name (case is ignored). Used with
 JOB and SPLNBR to locate the SPOOLED file.
 *LAST returns the last SPOOLED file created by
 this job (uses QSPRILSP API).',

SPLNBR IS 'SPOOLED File Number. Specify a digit
 such as 38 or ''38'', or the special value
 ''*LAST''. When *LAST, the highest-numbered
 SPOOLED file matching SPLFNAME is returned.
 Ignored when SPLFNAME=>''*LAST''.',

JOB_NAME IS 'Fully qualified 3-part job name.
 Default ''*'' means the current job.
 Ignored when SPLFNAME=>''*LAST''.',

BLANK_LINES IS 'Controls blank/empty rows.
 *DROP (default) - Filter out blank lines.
 *KEEP | *INCLUDE | *YES - Include blanks.
 Overridden by OPTIONS=>*KEEP or OPTIONS=>*DROP.',

EOF IS 'End-of-File action for open SPOOLED files.
 *IGNORE (default) - End when EOF is reached.
 *WAIT - Wait for more data to be written.
 Ignored when SPOOLED file status is not OPN.',

START_PAGE IS 'First page to return.
 Default 1. Special values *FIRST and *LAST
 are supported. If START_PAGE exceeds the total
 page count, a message is logged and the
 function ends with no rows returned.',

START_LINE IS 'First line on START_PAGE to return.
 If larger than lines on the page, no data
 is returned for that page.',

INT_JOBID IS '16-byte internal job identifier.
 Overrides the JOB_NAME parameter.
 Retrieve from QUSRJOBI, QUSLJOB or QUSRSPLA.',

INT_SPLFID IS '16-byte internal SPOOLED file ID.
 Overrides the SPLFNAME parameter.
 Retrieve from QUSRSPLA or QUSLSPL.',

OPTIONS IS 'Zero or more options, blank/comma
 separated. Valid options:
 *UPPER  - Convert output to upper case.
 *LOWER  - Convert output to lower case.
 *LEFT | *LEFTADJ | *TRIMLEFT - Left-adjust.
 *TRIMRIGHT - Trim trailing blanks.
 *RULER  - Insert a column-position ruler row.
 *KEEP   - Retain blank lines in result set.
 *WAIT   - Wait for open SPOOLED file data.
 *DLTSPLF - Delete SPOOLED file when done.
 Leading asterisk and case are optional.',

SPOOLED_FILE_NAME IS 'Alternate SPLFNAME.
 Provided for compatibility with IBM Services
 SYSTOOLS.SPOOLED_FILE_DATA parameter names.
 When supplied, overrides SPLFNAME.',

SPOOLED_FILE_NUMBER IS 'Alternate SPLNBR.
 Provided for compatibility with IBM Services
 SYSTOOLS.SPOOLED_FILE_DATA parameter names.
 When supplied, overrides SPLNBR.'
);

GRANT EXECUTE
ON SPECIFIC FUNCTION SQLTOOLS.SPOOLED_DATA
TO PUBLIC ;
`;

export function getSpooledDataSQLSrc(library: string, version: number): string {
    return applySqlSourceTokens(SQL_TEMPLATE, library, version);
}
