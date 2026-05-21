/**
 * Generates the SQL DDL used to create (or replace) the CMD_XML UDTF in the
 * target library on IBM i.
 *
 * The version number is embedded in the LONG_COMMENT of the specific routine so
 * CmdXmlChecker.getRemoteState() can detect stale installs and trigger update().
 */
export function getCmdXmlSQLSrc(library: string, version: number): string {
    return `
CREATE or REPLACE FUNCTION ${library}.CMD_XML(
                              LIBRARY_NAME varchar(10) DEFAULT '*LIBL',
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
    SPECIFIC ${library}.cmd_xml
    EXTERNAL NAME '${library}/CMDXML'
    PARAMETER STYLE DB2SQL;

LABEL on specific routine ${library}.cmd_xml IS
'Retrieve Command Statement Definition as XML';

comment on SPECIFIC FUNCTION ${library}.cmd_xml is
'${version} - Retrieve Command Definition statements (CMD, PARM, QUAL, ELEM, DEP, PMTCTL) as XML via QCDRCMDD API';

comment on parameter specific function ${library}.cmd_xml
(LIBRARY_NAME IS 'The name of the library where the *CMD object specified
on the CMD_NAME parameter is located. The special values *LIBL and *CURLIB
are supported. The default is *LIBL',

CMD_NAME IS 'The name of the CL command whose source code XML is
to be retrieved. Upper/lower case is ignored.'
);
`;
}
