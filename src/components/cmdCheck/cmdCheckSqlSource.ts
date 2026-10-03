/**
 * Generates SQL DDL for the UDTF from embedded source SQL.
 *
 * Source origin: /Users/cozzi/Downloads/projects/open-UDTF/src/CMD_CHECK/CMD_CHECK.SQL
 */
import { applySqlSourceTokens } from '../sqlSourceTokens';

const SQL_TEMPLATE = String.raw`CREATE or REPLACE FUNCTION sqltools.CMD_CHECK (
                                  CMD       VARCHAR(6000),
                                  CHECKOPT  VARCHAR(14) DEFAULT '*CLLE'
                                          )
            RETURNS table (
                    msgid   varchar(7),
                    msgsev int,
                    msgtext varchar(512),
                    cmdstring varchar(6000) -- reserved
              )
     LANGUAGE C++
     NO SQL
     NOT DETERMINISTIC
     NOT FENCED
     FINAL CALL
     DISALLOW PARALLEL
     CARDINALITY 3
     SCRATCHPAD 8400
     SPECIFIC sqlTools.cmd_check
     EXTERNAL NAME 'SQLTOOLS/CMD_CHECK'
     PARAMETER STYLE DB2SQL;


LABEL on specific routine sqlTools.cmd_check IS
'\${version} - CL Command Syntax Checker';

comment on specific FUNCTION sqlTools.cmd_check is
'\${version} - CL Command Syntax Checker (QCAPCMD Wrapper)
This function syntax checks the specified CL command and returns any
syntax error messages as its resultset. It is similar to using the
CMD_RUN UDTF with the MODE parameter set to MODE=>''*CHECK''.';

comment on parameter specific function sqlTools.cmd_check
(
CMD is 'CL command to be checked. A command length of up to 6000
  bytes is supported by this function',

CHECKOPT IS 'Command syntax checking option(s). Use this parameter
to control what kind of syntax checking is performed by this function.
The leading asterisk and upper/lower case is ignored.
The default is: <i>*CLLE</i> that syntax checks the provided CL command for
CLLE source members. The valid choices are:
<ul>
 <li><i>*CLLE</i> or *ILE - 9. Syntax check Cmd in ILE CL program source
(default)</li>
 <li>*CHECK or *CL - 1. Syntax Check Cmd (similar to QCMDCHK API)</li>
 <li>*LIMIT - 3. Limited User CL command syntax check</li>
 <li>*CLP - 4. OPM CL (e.g., CLP) syntax check</li>
 <li>*STREAM - 5. System/38 CL Stream batch jobs syntax check</li>
 <li>*CMD - 6. Command Definition syntax check (PARM, QUAL, ELEM, etc.)</li>
 <li>*BINDER or *BND - 7. Binder Source syntax check</li>
 <li>*PDM - 8. PDM User Defintion Option Command syntax check</li>
</ul>'
);

`;

export function getCmdCheckSQLSrc(library: string, version: number): string {
        return applySqlSourceTokens(SQL_TEMPLATE, library, version);
}
