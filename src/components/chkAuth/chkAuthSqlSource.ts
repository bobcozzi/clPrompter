/**
 * Generates SQL DDL for the UDTF from embedded source SQL.
 *
 * Source origin: /Users/cozzi/Downloads/projects/open-UDTF/src/CHK_AUTH/CHK_AUTH.SQL
 */
const SQL_TEMPLATE = String.raw`
 -- SPDX-License-Identifier: Apache-2.0
 -- Copyright (c) 1996-2026 by R. Cozzi, Jr.
 -- @author BobCozzi

-- Check User Authority to an Object
--
-- Source origin:
--      : /Users/cozzi/Downloads/projects/open-UDTF/src/CHK_AUTH/CHK_AUTH
--

CREATE or REPLACE FUNCTION SQLTOOLS.chk_auth(
                                   library_name varchar(10) DEFAULT '*LIBL',
                                   object_NAME  VARCHAR(10),
                                   objtype      VARCHAR(10) default '*FILE',
                                   auth         VARCHAR(96) default '*USE',
                                   user_name    VARCHAR(10) default '*CURRENT',
                                   callLvl      VARCHAR(10) default '*SAME'
                                  )
        returns int

    LANGUAGE C++
    NO SQL
    NO EXTERNAL ACTION
    NO FINAL CALL
    STATEMENT DETERMINISTIC
    NOT FENCED
    SPECIFIC sqlTools.chk_auth
    EXTERNAL NAME 'SQLTOOLS/CHK_AUTH'
    PARAMETER STYLE DB2SQL;


LABEL on specific routine sqltools.chk_auth IS
'\${version} Check user Profile authority to object';

COMMENT on SPECIFIC FUNCTION sqltools.chk_auth IS
'\${version} Check user Profile authority to an object.
 The authorization is determined if the user has all rights to the object
 specified on the AUTH parameter.
<ul>
<li> Return value 1 = Authorized.</li>
<li> Return value 0 = not authorized.</li>
</ul>';

Comment on Parameter Specific FUNCTION sqltools.chk_auth
(
 LIBRARY_NAME IS 'The name of the library where the object specified on
the OBJECT_NAME parameter is located.
The special values *LIBL and *CURLIB are supported. If unspecified *LIBL is
used. Upper/lower case is ignored.',

OBJECT_NAME is 'The object name being checked for the  User''s authority.
Upper/lower case is ignored.',

OBJTYPE is 'The IBM i object type of the object specified on the OBJECT_NAME
parameter. Upper/lower case is ignored, and the leading asterisk is option.',

AUTH is 'A list of one or more authorities being checked for. Up to 10
authorities may be specified (listed below). Each authority must be
seperated by one or more blanks or commas. Upper/lower case and the
leading asterisk are ignored. The valid authority choices are:<ul>
 <li><u>*USE</u> - *OBJOPR *READ and *EXECUTE authority</li>
 <li>*ALL - All authority</li>
 <li>*CHANGE -  *OBJOPR *OBJREF *OBJALTER *READ *ADD *DLT *UPD</li>
 <li>*EXCLUDE - Exclude authority</li>
 <li>*AUTLMGT- For *AUTL objects, Authorization List mgt authority</li>
 <li>*OBJALTER - Object alter authority</li>
 <li>*OBJOPER  - Object operational authority</li>
 <li>*OBJMGT   - Object management authority</li>
 <li>*OBJEXIST - Object existence authority</li>
 <li>*OBJREF   - Object reference authority</li>
 <li>*READ     - Read authority</li>
 <li>*ADD or *WRITE - Add authority</li>
 <li>*UPD or *UPDATE - Update authority</li>
 <li>*DLT or *DELETE - Delete authority</li>
 <li>*EXECUTE or *RUN - Run a program</li>
</ul>',

USER_NAME is 'The user profile whose authority to the object is checked.
Upper/lower case is ignored.'
);

`;

export function getChkAuthSQLSrc(library: string, version: number): string {
    return SQL_TEMPLATE
        .replace(/\\\$\{version\}/gi, String(version))
        .replace(/\$\{version\}/gi, String(version))
        .replace(/sqltools\./gi, `${library}.`)
        .replace(/SQLTOOLS\//g, `${library}/`);
}
