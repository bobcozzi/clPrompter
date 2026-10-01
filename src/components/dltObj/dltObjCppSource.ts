/**
 * Embedded source for DLT_OBJ.CPP.
 *
 * Source origin: /Users/cozzi/Downloads/projects/open-UDTF/src/DLT_OBJ/DLT_OBJ.CPP
 * Stored as plain text (no base64 encoding).
 */
export function getDltObjCPPSrc(): string {
    return String.raw`// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 by R. Cozzi, Jr.

// @author BobCozzi

////////////////////////////////////////////////////////////////////////
// IBM i SQL Function: DELETE_OBJECT / DLTOBJ
// This is an SQL UDF External Program
// It uses the QLIDLTO API to delete the object
////////////////////////////////////////////////////////////////////////
// This is part of the collection of open source SQL UDTFs that are
// primarily built for the VS CODE and CODE for IBM i IDE, however
// they can be feely used in other environments that permit running SQL:
//  - IBM ACS RUNSQL Scripts
//  - SQL iQuery
//  Available on github at:  https://github.com/bobcozzi/open-UDTF
////////////////////////////////////////////////////////////////////////

#ifndef __STDC_WANT_DEC_FP__
#define __STDC_WANT_DEC_FP__
#endif

#ifndef __POSIX_LOCALE__
#define __POSIX_LOCALE__
#endif

#include <sys/time.h>
#include <sys/stat.h>
#include <sys/types.h>

#pragma datamodel(P128)

#include <stdlib.h>
#include <unistd.h>
#include <stdio.h>
#include <string.h>
#include <errno.h>
#include <ctype.h>
#include <inttypes.h>
#include <langinfo.h>
#include <except.h>
#include <signal.h>

#include <QP0LSTDI.h>
#include <QP0ZTRC.h> // Qp0zLprintf

#include <qusec.h>
#include <qlg.h>
#include <qlgcase.h>
#include <letype.h>
#include <lecond.h>
#include <leenv.h>

#include <QMH.h>
#include <QMHSNDPM.h>
#include <QMHRCVPM.h>
#include <QMHRTVM.h>
#include <QLGCASE.h>
#include <QUSRJOBI.h>

#include <QDBRTVSN.h>
#include <QUSROBJD.h>
#include <QLIDLTO.h>

// include syntax when compiling from an IFS stream file
#include <mih/cpybytes.h>
#include <mih/triml.h>
#include <mih/MATPGMNM.h>

#include <cstring>
#include <cctype>
#include <string>
#include <memory>

#include <vector>
#include <algorithm>

using namespace std;

#include <sql.h>
#include <sqludf.h>

/* Case-conversion direction constants */
#ifndef _TOUPPER
#define _TOUPPER 0
#endif
#ifndef _TOLOWER
#define _TOLOWER 1
#endif

/* ============================================= */
/* qusec - IBM i standard error code wrapper */
/* ============================================= */

typedef struct tag_QUS_EC
{
    union
    {
        int Bytes_Provided;
        int length;
    };
    union
    {
        int Bytes_Available;
        int Bytes_Returned;
    };
    union
    {
        char Exception_Id[7];
        char msgid[7];
    };
    char Reserved;
    union
    {
        char Exception_Data[255];
        char msgdta[255];
    };
} qusec_t;

class qusec
{
public:
    qusec() { init(); }
    void init()
    {
        memset((char *)&ec, 0x00,
               sizeof(ec) + sizeof(xtra));
        ec.Bytes_Provided =
            (int)(sizeof(ec) + sizeof(xtra));
    }
    void clear()
    {
        init();
        ec.Bytes_Provided = 0;
    }
    void reset() { init(); }
    int isEmpty()
    {
        return ec.Bytes_Available == 0;
    }
    int isNotEmpty()
    {
        return ec.Bytes_Available != 0;
    }
    int hasError()
    {
        return ec.Bytes_Available > 0;
    }
    int isError()
    {
        return ec.Bytes_Available > 0;
    }
    int hasNoError()
    {
        return ec.Bytes_Available == 0;
    }
    /* Compare Exception_Id up to 7 chars */
    bool compare(const char *pMsgID)
    {
        if (ec.Bytes_Available == 0)
            return false;
        int n = (int)strlen(pMsgID);
        if (n > 7)
            n = 7;
        return (memcmp(ec.Exception_Id,
                       pMsgID, n) == 0);
    }
    char *msgid()
    {
        return ec.Exception_Id;
    }
    bool startsWith(const char *prefix)
    {
        return strncmp(ec.Exception_Id, prefix, std::min<int>(7, std::strlen(prefix))) == 0;
    }
    char *msgdata()
    {
        int avail = ec.Bytes_Available;
        if (avail > 16)
        {
            char *p = (char *)&ec + 16;
            int dlen = avail - 16;
            if (dlen < (int)sizeof(xtra))
                p[dlen] = 0x00;
            return p;
        }
        return NULL;
    }
    int getMsgDataLen()
    {
        int a = ec.Bytes_Available;
        return (a > 16) ? a - 16 : 0;
    }
    operator void *() { return &ec; }
    operator Qus_EC_t *()
    {
        return (Qus_EC_t *)&ec;
    }

private:
    qusec_t ec;
    char xtra[256];
};

inline char *getNextParmIf(int &pC, int &argc, char **argv, int ioFlag = 0);

#define inChar(_v) \
    char *in##_v = \
        (char *)getNextParmIf(p, argc, argv)

#define outInt(_v) \
    int *out##_v = \
        (int *)getNextParmIf(p, argc, argv)

#define inIndy(_v)      \
    short *indyIn##_v = \
        (short *)getNextParmIf(p, argc, argv)
#define outIndy(_v)   \
    short *indy##_v = \
        (short *)getNextParmIf(p, argc, argv, 2)

// copyPad copies maxLen bytes from a fixed src to a fixed target with blank padding
inline void copyPad(char *dest, const char *src, int maxLen = 10)
{
    memset(dest, ' ', maxLen);
    _CPYBYTES(dest, src, std::min<int>(strlen(src), maxLen));
}

#define makeAPIObjName(_out, _obj, _lib)                    \
    memset(_out, ' ', 10);                                  \
    _CPYBYTES(_out, _obj, std::min<int>(10, strlen(_obj))); \
    memset(_out + 10, ' ', 10);                             \
    _CPYBYTES(_out + 10, _lib, std::min<int>(10, strlen(_lib)))

int getObjSysName(char *object, char *library, const char *longObject, const char *longLibrary, const char *objType);
int makeUpper(char *szData, int inLen = 0, int ccsid = 0);
bool startsWith(const char *target,  const char *prefix, size_t tgtLen = 0);

int DLTOBJ(const char *qualObjName, const char *objType, const char *ASPName = "*", const char* RMVMSG = "1");

int main(int argc, char *argv[])
{
    /**********************************************************/
    /* Syntax Check or run CL commands via QCAPCMD API        */
    /**********************************************************/

    int p = 0;

    //////////////////////////////////////////////
    //  PARMS Parameter declaration section
    //////////////////////////////////////////////

    //////////////////////////////////////////////
    //  INPUT Parameters
    //////////////////////////////////////////////
    inChar(LIBNAME);
    inChar(OBJNAME);
    inChar(OBJTYPE);
    inChar(ASPNAME); // * *SYSBAS, *CURASPGRP, *ALLAVL, or <aspname> Char(10)
    inChar(RMVMSG);  // Remove successful resulting diag/comp message(s)
    inChar(PROTECT);
    inChar(CVTCASE);

    //////////////////////////////////////////////
    //  OUTPUT Parameters
    //////////////////////////////////////////////
    outInt(SUCCESS);

    //////////////////////////////////////////////
    //  Input Indicator Fields
    //////////////////////////////////////////////
    inIndy(LIBNAME);
    inIndy(OBJNAME);
    inIndy(OBJTYPE);
    inIndy(ASPNAME);
    inIndy(RMVMSG);
    inIndy(PROTECT);
    inIndy(CVTCASE);

    //////////////////////////////////////////////
    //  Output Indicator Fields
    //////////////////////////////////////////////
    outIndy(SUCCESS);

    ////////////////////////////////////////////////////////////
    //  SQL specific parameters
    ////////////////////////////////////////////////////////////
    char *sqlstate = (char *)getNextParmIf(p, argc, argv);
    char *sqlFuncName = (char *)getNextParmIf(p, argc, argv);
    char *specificName = (char *)getNextParmIf(p, argc, argv);
    char *sqlmsgtext = (char *)getNextParmIf(p, argc, argv);

    ////////////////////////////////////////////////////////////
    //  BEGIN main() body (after parms starts here)
    ////////////////////////////////////////////////////////////

    _MATPGMNM_Template_T pgm;
    memset(&pgm, 0x00, sizeof(pgm));

    _FEEDBACK fc;
    qusec ec;

    // "this" program's name

    pgm.Template_Size = sizeof(pgm);
    _MATPGMNM(&pgm);

    char OBJNAME[11];
    char LIBNAME[11];
    char OBJTYPE[11];
    char ASPNAME[11];
    char RMVMSG[1]; // '0' or '1'
    int  PROTECT = 1;
    int  CVTCASE = 1;

    *outSUCCESS = 0;     // Initialize returned code to 0=Not deleted

    if (*indyInPROTECT >= 0 && strlen(inPROTECT) > 0)
    {
        makeUpper(inPROTECT, strlen(inPROTECT));
        if (inPROTECT[0] == '*')
        {
            inPROTECT++;
        }
        switch (inPROTECT[0])
        {
            case '1':
            case 'Y':
            case 'T':
            case 'P':
                PROTECT = 1;
                break;
            default:
                PROTECT = 0;
                break;
            }
    }
  if (*indyInCVTCASE >= 0 && strlen(inCVTCASE) > 0)
    {
        makeUpper(inCVTCASE, strlen(inCVTCASE));
        if (inCVTCASE[0] == '*')
        {
            inCVTCASE++;
        }
        switch (inCVTCASE[0])
        {
            case '1':
            case 'Y':
            case 'T':
            case 'P':
                CVTCASE = 1;
                break;
            default:
                CVTCASE = 0;
                break;
            }
    }

    if (CVTCASE)
    {
        makeUpper(inOBJNAME);
        makeUpper(inLIBNAME);
    }

    makeUpper(inOBJTYPE, strlen(inOBJTYPE));
    if (inOBJTYPE[0] == '*')
    {
        inOBJTYPE++;
    }
    OBJTYPE[0] = '*';
    strcpy(OBJTYPE + 1, inOBJTYPE);

    // Convert potential Long Object/Library Names to short names
    if (getObjSysName(OBJNAME, LIBNAME, inOBJNAME, inLIBNAME, OBJTYPE))
    {
        if (*indyInASPNAME >= 0 && strlen(inASPNAME) > 0)
        {
            makeUpper(inASPNAME, strlen(inASPNAME));
            strcpy(ASPNAME, inASPNAME);
        }
        if (*indyInRMVMSG >= 0 && strlen(inRMVMSG) > 0)
        {
            makeUpper(inRMVMSG, strlen(inRMVMSG));
            if (inRMVMSG[0] == '*')
            {
                inRMVMSG++; // skip leading *asterisk
            }
            switch (inRMVMSG[0])
            {
            case '1':
            case 'Y':
            case 'S':
            case 'R':
                RMVMSG[0] = '1';
                break;
            default:
                RMVMSG[0] = '0';
                break;
            }
        }

        if ((startsWith(LIBNAME, "QSYS") ||
             startsWith(LIBNAME, "SYS") ||
             startsWith(LIBNAME, "SQL") ||
             startsWith(LIBNAME, "Q")) && !startsWith(LIBNAME,"QTEMP"))
        {
            Qp0zLprintf("DLTOBJ: %s in %s type %s is in a protected library. Delete request cancelled.\n",
                                inOBJNAME, inLIBNAME, inOBJTYPE);
            return 0;
        }
        if (startsWith(OBJNAME, "*ALL"))
        {
            Qp0zLprintf("DLTOBJ: OBJECT_NAME=>*ALL is not permitted by this routine. The delete request is cancelled.\n");
            return 0;
        }

        char qualObjName[21];
        makeAPIObjName(qualObjName, OBJNAME, LIBNAME);
        *outSUCCESS = DLTOBJ(qualObjName, OBJTYPE, ASPNAME, RMVMSG);
    }
    return 0;

} // end main

/* ============================================= */
/* getNextParmIf()                               */
/* Advance parameter counter and return argv[n]. */
/* If ioFlag>0, memset output parm to 0x00.      */
/* ============================================= */
inline char *getNextParmIf(
    int &pC,
    int &argc,
    char **argv,
    int ioFlag)
{
    char *pRtn = NULL;
    if (argc > pC + 1)
    {
        pRtn = argv[++pC];
        if (ioFlag > 0)
            memset(pRtn, 0x00, ioFlag);
    }
    return pRtn;
}

/* ============================================= */
/* resignalMsg                                   */
/* Re-send an IBM i API error as a program msg.  */
/* ============================================= */
void resignalMsg(qusec &ec)
{
    char msgfile[21];
    char msgtype[11];
    char msgkey[4];
    char topgmq[11];
    char msgPrefix[3];
    char msgType[3];
    qusec_t fc;

    memset((char *)&fc, 0x00, sizeof(fc));
    fc.Bytes_Provided = sizeof(fc);
    memset(msgkey, ' ', sizeof(msgkey));
    memset(msgfile, ' ', sizeof(msgfile));
    memset(topgmq, ' ', sizeof(topgmq));
    topgmq[0] = '*';

    if (ec.isEmpty())
        return;
    _CPYBYTES(msgPrefix, ec.msgid(), 2);
    _CPYBYTES(msgType, ec.msgid() + 2, 1);
    msgType[1] = 0x00;
    msgPrefix[2] = 0x00;
    if (strcmp(msgPrefix, "CP") == 0)
    {
        makeAPIObjName(msgfile,"QCPFMSG", "*LIBL");
    }
    else if (strcmp(msgPrefix, "RN") == 0)
    {
        makeAPIObjName(msgfile,"QRPGLEMSG", "QDEVTOOLS");
    }
    else if (strcmp(msgPrefix, "HT") == 0)
    {
        makeAPIObjName(msgfile,"QHTTPMSG", "QHTTPSVR");
    }
    else if (strcmp(msgPrefix, "CE") == 0)
    {
        makeAPIObjName(msgfile,"QCEEMSG", "QSYS");
    }
    else if (strcmp(msgPrefix, "GU") == 0)
    {
        makeAPIObjName(msgfile,"QGUIMSG", "QSYS");
    }
    else if (strcmp(msgPrefix, "IW") == 0)
    {
        makeAPIObjName(msgfile,"QIWSMSG", "QSYS");
    }
    else
    {
        makeAPIObjName(msgfile,"QCPFMSG", "*LIBL");
    }
    switch (msgType[0])
    {
    case 'F':
    case 'I':
        copyPad(msgtype, "*INFO", 10);
        break;
    case 'E':
        copyPad(msgtype, "*ESCAPE", 10);
        break;
    case 'D':
        copyPad(msgtype, "*DIAG", 10);
        break;
    case 'C':
        copyPad(msgtype, "*COMP", 10);
        break;
    default:
        copyPad(msgtype, "*INFO", 10);
        break;
    }
    QMHSNDPM(ec.msgid(), msgfile,
             ec.msgdata(),
             ec.getMsgDataLen(),
             msgtype, topgmq, 1,
             msgkey, &fc);
}

bool startsWith(const char *target,  const char *prefix, size_t tgtLen)
{
    if (target == NULL || prefix == NULL)
        return false;

    size_t prefixLen = std::strlen(prefix);
    size_t targetLen = (tgtLen == 0) ? std::strlen(target) : tgtLen;
    if (prefixLen > targetLen)
        return false;

    return std::memcmp(target, prefix, prefixLen) == 0;
}


int makeUpper(char *szData, int inLen, int ccsid)
{

    Qlg_CCSID_ReqCtlBlk_T frcb;
    qusec ec;
    long len = 0;
    char *pIn = szData;
    char *pOut = szData;

    memset((char *)&frcb, 0x00, sizeof(frcb));
    frcb.Type_of_Request = 1;
    frcb.Case_Request = _TOUPPER;
    frcb.CCSID_of_Input_Data = ccsid;

    if (inLen <= 0)
    {
        len = strlen(pIn);
    }
    else
    {
        len = inLen;
    }

    ec.init();
    if (len > 0)
    {
        if (*pIn != '"')  // Skip "Quoted Names"
        {
            QlgConvertCase((char *)&frcb, (char *)pIn,
                            pOut, &len,
                           (char *)&ec);
        }
    }
    return len;
}

int getObjSysName(char *object, char *library, const char *longObject, const char *longLibrary, const char *objType)
{

    const int LONG_NAME_MAX_LEN = 128;

    qusec ec;

    char longObj[129];
    char longLib[129];
    char shortObj[11];
    char shortLib[11];
    char rtnObj[21];
    int len = 0;
    int lenLib = strlen(longLibrary);
    int lenObj = strlen(longObject);

    memset(longLib, 0x00, sizeof(longLib));
    memset(longObj, 0x00, sizeof(longObj));

    memset(shortLib, ' ', sizeof(shortLib));
    memset(shortObj, ' ', sizeof(shortObj));
    memset(rtnObj, ' ', sizeof(rtnObj));

    if (lenLib > 10 && strchr(longLibrary, '*') == NULL) // Long Library nanme?
    {
        _CPYBYTES(longLib, longLibrary, std::max<int>(LONG_NAME_MAX_LEN, lenLib));

        ec.init();
        QDBRTVSN(&rtnObj, longLib, lenLib, shortLib, &ec);

        if (ec.isEmpty())
        { // Since we're doing a library, then the lib name is
          // in positions 1 to 10 of the rtnObj variable.
          // and "QSYS" would be in positions 11 to 20, but we don't care about that.
            _CPYBYTES(shortLib, rtnObj, 10);
        }
        else
        {
            resignalMsg(ec);
            return 0;
        }
    }
    else
    {
        _CPYBYTES(shortLib, longLibrary, lenLib);
    }

    // At this point we should have the Short library name in "shortLib"
    // Now get the Short object name from a long object name
    if (lenObj > 10 && strchr(longObject, '*') == NULL)
    {
        _CPYBYTES(longObj, longObject, lenObj);

        ec.init();
        QDBRTVSN(&rtnObj, longObj, lenObj, shortLib, &ec);

        if (ec.isEmpty())
        { // Note:
            // Returned object name is in positions 1 to 10
            // Returned library name is in position 11 to 20
            // Copy new name from rtnobj just in case *CURLIB/*LIBL were used
            memset(shortLib, ' ', sizeof(shortLib));
            shortLib[sizeof(shortLib) - 1] = 0x00;
            _CPYBYTES(shortLib, rtnObj+10, 10);
            shortLib[::triml(shortLib, ' ')] = 0x00;

            memset(shortObj, ' ', sizeof(shortObj));
            shortObj[sizeof(shortObj) - 1] = 0x00;
            _CPYBYTES(shortObj, rtnObj, 10);
            shortObj[::triml(shortObj, ' ')] = 0x00;
        }
        else
        {
            resignalMsg(ec);
            return 0;
        }
    }
    else
    {
        memset(shortObj, 0x00, sizeof(shortObj));
        _CPYBYTES(shortObj, longObject, lenObj);
    }
    strcpy(object, shortObj);
    strcpy(library, shortLib);

    return 1;
}

/* ============================================= */
/* coz_DLTOBJ                                    */
/* Delete an IBM i object via QLIDLTO API.       */
/* ============================================= */
int DLTOBJ(
    const char* qualObjName,
    const char* objType,
    const char* ASPName,
    const char* RMVMSG)
{
    qusec ec;
    char szObjType[11];
    char szASP[11];
    char rmvMsg[1];



    if (qualObjName == NULL ||
        qualObjName[0] == ' ' ||
        qualObjName[0] == 0x00)
        return 0;

    copyPad(szObjType, objType, 10);
    copyPad(szASP, ASPName, 10);
    rmvMsg[0] = RMVMSG[0];

    ec.init();
    QLIDLTO((char *)qualObjName,  // 1. Qualified Object name
            szObjType,            // 2. IBM i Object Type
            szASP,                // 3. ASP Name
            rmvMsg,               // 4. Remove Message flag '1'=True
            &ec);                 // 5. Exception/Error structure
    if (ec.hasError())
    {
        resignalMsg(ec);
    }
    return (ec.isEmpty()) ? 1 : 0;
}

//  Message handling/forwarding (result Set message list)

#pragma datamodel(pop)

`;
}
