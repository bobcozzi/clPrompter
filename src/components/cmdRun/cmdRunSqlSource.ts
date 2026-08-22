/**
 * Generates the SQL DDL used to create (or replace) the CMD_RUN UDTF in the
 * target library on IBM i.
 *
 * The version number is embedded in the LONG_COMMENT of the specific routine so
 * CmdRunChecker.getRemoteState() can detect stale installs and trigger update().
 */
export function getCmdRunSQLSrc(library: string, version: number): string {
  return `
-- CL Command Processor for IBM i
  -- This function runs a CL command.
  -- Note the options for the MODE parameter are:
  -- *RUN (run CL command) or *LIMIT (limited user mode).
  -- It runs the command as if it were on a Command Entry display,
  -- or, for Limited Users, as if it were on that limited user command line.
  -- For syntax checking, use the CMD_CHECK function instead.

CREATE or REPLACE FUNCTION ${library}.CMD_RUN(
                                    CMD   VARCHAR(32700),
                                    MODE  VARCHAR(14) DEFAULT '*RUN'
                                          )
            RETURNS table (
                    ORDINAL_POSITION smallint,
                    msgid   varchar(7),
                    msgsev  int,
                    msgtype varchar(10),
                    sent_timestamp timestamp(6),
                    msgtext varchar(2000),
                    sent_by_user varchar(10),
                    sent_From_pgm varchar(10),
                    sent_From_stmt char(4),
                    sent_From_Mod varchar(10),
                    sent_From_Proc varchar(255),

                    sent_To_pgm varchar(10),
                    sent_To_stmt char(4),
                    sent_To_Mod varchar(10),
                    sent_To_Proc varchar(255),

                    seclvlMsg varchar(4000)
              )
     LANGUAGE C++
     NO SQL
     NOT DETERMINISTIC
     NOT FENCED
     NO FINAL CALL
     DISALLOW PARALLEL
     CARDINALITY 5
     SCRATCHPAD 2000
     SPECIFIC ${library}.cmd_run
     EXTERNAL NAME '${library}/CMDRUN'
     PARAMETER STYLE DB2SQL;


LABEL on specific routine ${library}.cmd_run IS
'${version} - Run or Check CL commands via QCAPCMD';

comment on specific FUNCTION ${library}.cmd_run is
'${version} - CL Command Processor to Run and Syntax Checker CL commands<br />
The resultSet returns the MSGID, MSGSEV, MSGTYPE, 1st Level Message Text,
and 2nd Level Message text (sometimes called "Message Help"). <br />
When running a CL command, if no messages are generated the resultSet
is empty. When checking CL command sytnax, if no syntax errors are detected,
the resultSet is empty.';

comment on parameter specific function ${library}.cmd_run
(
CMD is 'CL command to be processed. A command length under 32k bytes is
supported by this function. Command Prompting is not supported.',

MODE IS 'Processing mode. Use this parameter to control whether the
function syntax checks the CL command or runs it. All modes syntax check
the CL command. The *RUN, *LIMIT (or *RUNLIMIT) modes syntax check
the CL command and then immediately run the command.
<ul><li>*RUN - Run a command like Command Entry</li>
<li>*LIMIT - Run a command as a "limited User"</li>
<li>*CHECK - Syntax Check a CL command</li>
<li>*CHECKLIMIT - Syntax Check a CL command for a "limited User"</li>
</ul>
The leading asterisk and upper/lower case is ignored.
The default is: <i>*RUN - Run CL Command</i>'
);`;
}
