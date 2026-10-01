/**
 * Generates SQL DDL for the UDTF from embedded source SQL.
 *
 * Source origin: /Users/cozzi/Downloads/projects/open-UDTF/src/DLT_OBJ/DLT_OBJ.SQL
 */
const SQL_TEMPLATE = String.raw`
-- SPDX-License-Identifier: Apache-2.0
-- Copyright (c) 1996-2026 by R. Cozzi, Jr.
-- @author BobCozzi

   -- SQL Tools UDF - (DLT_OBJ) Delete Object

CREATE or REPLACE FUNCTION sqltools.DLT_OBJ (
                                 LIBRARY_NAME varchar(128) DEFAULT '*LIBL',
                                 OBJECT_NAME  varchar(128),
                                 OBJTYPE      varchar(10),
                                 ASP_NAME     varchar(10) DEFAULT '*SYSBAS',
                                 RMVMSG       varchar(10) DEFAULT '*NO',
                                 PROTECT      varchar(10) DEFAULT '*YES',
                                 CONVERT_NAME  varchar(10) DEFAULT '*YES'
                                   )
        RETURNS INT

     LANGUAGE C++
     NO SQL
     NO FINAL CALL
     EXTERNAL ACTION
     NOT DETERMINISTIC
     NOT FENCED
     SPECIFIC sqlTools.DELETE_OBJECT
     EXTERNAL NAME 'SQLTOOLS/DLT_OBJ'
     PARAMETER STYLE DB2SQL;


LABEL on specific routine sqltools.DELETE_OBJECT  IS
'\${version} Delete IBM i Object';

COMMENT ON SPECIFIC FUNCTION sqltools.DELETE_OBJECT  IS
'\${version} Delete IBM i Object. This routine deletes an IBM i object in
the library specified. Both the object name and/or library name may be
the standard 10-character system object name or a Long SQL Name.';

COMMENT on parameter SPECIFIC FUNCTION sqltools.DELETE_OBJECT
(
library_name is 'The library name containing the Object
to be deleted. If no library name is specified, then *LIBL is used.
This parameter may be specified using either the standard "short"
system object name (up to 10 characters) or it may be a long SQL name.
The symbolic library names *LIBL or *CURLIB may be specified.',

OBJECT_NAME IS 'The name of the object that is to be deleted.
The object name may be a full object name or a generic object name,
or if the object type is *FILE, then a long SQL name may be specified.
Note *ALL is blocked by this function and may not be used.',

OBJTYPE  IS 'The standard IBM i Object Type for the object that is
to be deleted, such as *FILE, *PGM, *USRSPC, etc.
The leading asterisk and upper/lower case is ignored.',

ASP_NAME  IS 'Auxiliary Storage Pool (ASP) Device Name of the library name.
choices are: <ul><li>*</li>
 <li>*SYSBAS</li>
 <li>*CURASPGRP</li>
 <li>*ALLAVL</li></ul>
 THe asterisk is required, and upper/lower case is ignored.',

RMVMSG IS 'Controls whether the CPC2191 Object Deleted message is generated
or suppressed. The valid choices are *YES or *NO, ''1'', or ''0''.
The default *NO causes the CPC2191 message to be written to the joblog.
Other messages, such as not found, invalid name, etc. are always sent to
the joblog.',

PROTECT is 'Limits whether to permit objects in QSYS or any library
that starts with ''Q'', ''SYS'', ''IBM'', or ''SQL'' from being deleted.
The valid choices are:<ul><li><i>*YES</i> - Protect system objects
(default)</li>
<li>*NO - Do not protect system objects</li></ul>
It is recommended to keep this parameter at its default of YES.
The leading asterisk and upper/lower case is ignored.',

CONVERT_NAME is 'Controls whether or not to automatically convert the
value of the OBJECT_NAME and LIBRARY_NAME parameters to upper case.
In rare cases, IBM i interfaces can create object names that contain
lower case characters, without the required "Hello" quotes.
Use this parameter to force the function to automatically convert the
input object and library name to all upper case except when enclosed in "..".
The valid choices are:<ul><li><i>*YES</i> - Convert to upper case</li>
<li>*NO - Do not convert to upper case</li></ul>
<p>Note: Object names encloded in double quotes (e.g., "Old.file")
are never capitalized by this function regardless of the value of
this parameter.</p>
<p>The leading asterisk and upper/lower case is ignored.</p>'
);

`;

export function getDltObjSQLSrc(library: string, version: number): string {
   return SQL_TEMPLATE
      .replace(/\\\$\{version\}/gi, String(version))
      .replace(/\$\{version\}/gi, String(version))
      .replace(/sqltools\./gi, `${library}.`)
      .replace(/SQLTOOLS\//g, `${library}/`);
}
