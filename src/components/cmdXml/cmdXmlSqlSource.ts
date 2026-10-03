/**
 * Generates SQL DDL for the UDTF from embedded source SQL.
 *
 * Source origin: /Users/cozzi/Downloads/projects/open-UDTF/src/CMD_XML/CMD_XML.SQL
 */
import { applySqlSourceTokens } from '../sqlSourceTokens';

const SQL_TEMPLATE = String.raw`
CREATE or REPLACE FUNCTION SQLTOOLS.cmd_xml(
                              LIBRARY_NAME varchar(10) default '*LIBL',
                              CMD_NAME     varchar(10)
                                     )
    RETURNS table (
            CMD_XML CLOB(16M) CCSID 1208
          )

    LANGUAGE C++
    NO SQL
    EXTERNAL ACTION
    NO FINAL CALL
    STATEMENT DETERMINISTIC
    NOT FENCED
    CARDINALITY 1
    SCRATCHPAD 256
    SPECIFIC sqlTools.cmd_XML
    EXTERNAL NAME 'SQLTOOLS/CMD_XML'
    PARAMETER STYLE DB2SQL;


LABEL on specific routine sqltools.cmd_XML IS
'\${version} Retrieve Command Statement Defintion as XML';

comment on SPECIFIC FUNCTION sqltools.cmd_XML  is
 '\${version} Retrieve Command Definition statements (CMD, PARM, QUAL, ELEM, DEP, PMTCTL)
 as XML. Returns the results from a call to the QCDRCMDD API
 as a CLOB, ready for processing via XMLTABLE or other functions.';

comment on parameter specific function sqltools.cmd_XML
(LIBRARY_NAME IS 'The name of the library where the *CMD object specified
on the CMD_NAME parameter is located. The special values *LIBL and *CURLIB
are supported. The default is *LIBL',

CMD_NAME IS 'The name of the CL command whose source code XML is
to be retrieved. Upper/lower case is ignored.'
);

`;

export function getCmdXmlSQLSrc(library: string, version: number): string {
    return applySqlSourceTokens(SQL_TEMPLATE, library, version);
}
