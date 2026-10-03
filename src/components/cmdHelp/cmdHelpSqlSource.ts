/**
 * Generates SQL DDL for the UDTF from embedded source SQL.
 *
 * Source origin: /Users/cozzi/Downloads/projects/open-UDTF/src/CMD_HELP/CMD_HELP.SQL
 */
import { applySqlSourceTokens } from '../sqlSourceTokens';

const SQL_TEMPLATE = String.raw`
 -- SPDX-License-Identifier: Apache-2.0
 -- Copyright (c) 1996-2026 by R. Cozzi, Jr.
 -- @author BobCozzi

 -- Retrieve HTML for a CL command's helptext
 --
 -- Source origin:
 --        /Users/cozzi/Downloads/projects/open-UDTF/src/CMD_HELP/CMDHELP


 CREATE or REPLACE FUNCTION sqltools.cmd_help(
                               library_name varchar(10) DEFAULT '*LIBL',
                               cmd_name     varchar(10),
                               helpid       varchar(6000) DEFAULT '*CMD'
                                              )
    RETURNS table (
            HELP_XML CLOB(16M) CCSID 1208
          )

     LANGUAGE C++
     NO SQL
     EXTERNAL ACTION
     NO FINAL CALL
     STATEMENT DETERMINISTIC
     NOT FENCED
     CARDINALITY 1
     SCRATCHPAD 256
     SPECIFIC sqlTools.cmd_help
     EXTERNAL NAME 'SQLTOOLS/CMD_HELP'
     PARAMETER STYLE DB2SQL;

LABEL on specific routine sqltools.cmd_help  IS
'\${version} Retrieve Command Help Text panels';

comment on specific function sqltools.cmd_help is
'\${version} Retrieve Command Help Text panels.
This is a high performance interface to retrieve the helptext panel groups
for the specified CL command. Unlike the GENCMDDOC CL command, this interface
never starts a JVM (Java VM) and therefore the help panels are returned
immediately.';

comment on parameter specific function sqltools.cmd_help
(LIBRARY_NAME IS 'The name of the library where the *CMD object specified
on the CMD_NAME parameter is located. The special values *LIBL and *CURLIB
are supported. The default *LIBL is used when the parameter is omitted.
Upper/lower case is ignored.',

CMD_NAME IS 'The name of the CL command whose helptext is to be retrieved.
Upper/lower case is ignored.',

HELPID IS 'A comma separated list of help ID whose helptext is to be
returned. This is normally a list of the command''s parameter keywords.
The default, *CMD is used to retreive the Command''s help text.
When I parameter (keyword) name is specified, the help panel for that
specific parameter is returned.'
);

`;

export function getCmdHelpSQLSrc(library: string, version: number): string {
    return applySqlSourceTokens(SQL_TEMPLATE, library, version);
}
