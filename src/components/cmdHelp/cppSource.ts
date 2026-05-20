/**
 * Embedded source for CMDHELP.CPP — the C++ service program that backs the
 * CMD_HELP UDTF.  Stored here so the extension can upload and compile it on
 * first connection without requiring a separate file distribution.
 *
 * Source origin: open-UDTF/src/CMD_HELP/CMDHELP.CPP
 * (c) 2020-2026 R. Cozzi, Jr.
 */
export function getCmdHelpCPPSrc(): string {
    // String.raw preserves backslash line-continuations that are required by the
    // #pragma exception_handler and other IBM i compiler directives.
    return String.raw`
     // (c) 2020 - Bob Cozzi, Jr.

#ifndef __STDC_WANT_DEC_FP__
#define __STDC_WANT_DEC_FP__
#endif

#ifndef __POSIX_LOCALE__
#define __POSIX_LOCALE__
#endif


#include <sys/time.h>
#include <sys/types.h>

#pragma datamodel(P128)


#include <stdlib.h>
#include <stdarg.h>
#include <stdio.h>
#include <unistd.h>
#include <string.h>
#include <p_time.h>
#include <time.h>

#include <langinfo.h>
#include <QP0LSTDI.h>
#include <QP0ZTRC.h>

#include <sys/stat.h>
#include <sys/types.h>

#include <time.h>
#include <errno.h>
#include <ctype.h>
#include <inttypes.h>
#include <decimal.h>

#include <qusgen.h>
#include <qusec.h>
#include <QUSCRTUS.h>
#include <QUSCUSAT.h>
#include <QUSPTRUS.h>
#include <QLIDLTO.h>
#include <qmhsndpm.H>
#include <QMHRCVPM.h>
#include <QMHRMVPM.h>
#include <qlgcase.h>
#include <lecond.h>
#include <except.h>

#include <QUHRHLPT.h>   // Retrieve Panel Group
#include <QCDRCMDI.h>   // Retrieve CL Command Attributes

#include <mih/cpybytes.h>
#include <mih/triml.h>

#include <cstring>
#include <cctype>
#include <iostream>
#include <fstream>
#include <sstream>
#include <string>
#include <memory>
#include <ctime>

#include <algorithm>
#include <vector>

#include <SQL.h>
#include <SQLUDF.h>

using namespace std;

const int coz_MAXUSRSPACESIZE = 16711568;
const int coz_MAXMEM15M = 15662992;
/* Case-conversion direction constants */
#ifndef _TOUPPER
#define _TOUPPER 0
#endif
#ifndef _TOLOWER
#define _TOLOWER 1
#endif

/* ============================================= */
/* coz_qusec - IBM i standard error code wrapper */
/* ============================================= */

typedef struct tag_QUS_EC
 {
    union { int  Bytes_Provided; int  length; };
    union { int  Bytes_Available; int  Bytes_Returned; };
    union { char Exception_Id[7]; char msgid[7]; };
    char Reserved;
    union { char Exception_Data[255]; char msgdta[255]; };
 } qusec_t;


class coz_qusec {
public:
    coz_qusec() { init(); }
    void init() {
        memset((char*)&ec, 0x00,
               sizeof(ec) + sizeof(xtra));
        ec.Bytes_Provided =
            (int)(sizeof(ec) + sizeof(xtra));
    }
    void reset() { init(); }
    int isEmpty() {
        return ec.Bytes_Available == 0;
    }
    int isNotEmpty() {
        return ec.Bytes_Available != 0;
    }
    int hasError() {
        return ec.Bytes_Available > 0;
    }
    int isError() {
        return ec.Bytes_Available > 0;
    }
    int hasNoError() {
        return ec.Bytes_Available == 0;
    }
    /* Compare Exception_Id up to 7 chars */
    bool compare(const char* pMsgID) {
        if (ec.Bytes_Available == 0)
            return false;
        int n = (int)strlen(pMsgID);
        if (n > 7) n = 7;
        return (memcmp(ec.Exception_Id,
                       pMsgID, n) == 0);
    }
    char* msgid() {
        return ec.Exception_Id;
    }
    char* msgdata() {
        int avail = ec.Bytes_Available;
        if (avail > 16) {
            char* p = (char*)&ec + 16;
            int dlen = avail - 16;
            if (dlen < (int)sizeof(xtra))
                p[dlen] = 0x00;
            return p;
        }
        return NULL;
    }
    int getMsgDataLen() {
        int a = ec.Bytes_Available;
        return (a > 16) ? a - 16 : 0;
    }
    operator void*()     { return &ec; }
    operator Qus_EC_t*() {
        return (Qus_EC_t*)&ec;
    }
private:
    qusec_t ec;
    char    xtra[256];
};

typedef _Packed struct tagScratch
{
    int  length;        // Scratch Pad length
    char cmdName[11];
    char HELPID[21];    // Returned list of Help IDs
    char HELPTEXT[21];  // Returned Panel Group HelpText as XML
    char RTNHELPID[21];
    Quh_Ids_To_Rtv_t helpID; // Panel Group/ID to locate
    int eof;
} scratch_t;

scratch_t scratch;

/* ============================================= */
/* Helper function prototypes                    */
/* ============================================= */
inline void  coz_copyPad(char* t, const char* s, int padLen = 10, char padChar = ' ');
inline void  coz_DLTOBJ(const char* qualObjName, const char* objType, const char* ASPName = "*");
inline int   coz_toUpper(char* szData, int inLen = -1, int ccsid = 0);
inline int   coz_nameUpper(char* szData, int inLen = -1);

inline char* coz_TEMP_USRSPACE(char* rtnUSName, const char* objAttr = "SQLTOOLS", int initSize = 4096);
inline char* coz_getPtrUsrSpace(const char* p2PartUsrSpaceName);

inline void  coz_makeAPIObjName(char* objName, const char* qualObj, const char* dftLib = "*LIBL");
inline int   coz_copyUntil(char* t, const char* s, int maxLen = 10, const char* stopAt = NULL, bool bTrim = false);
inline void  coz_resignalMsg(coz_qusec& ec);
inline char* coz_getNextParmIf(int& pC, int& argc, char** argv, int ioFlag = 0);

#define inChar(_v) \
    char *in##_v = \
        (char*) coz_getNextParmIf(p,argc,argv)
#define outCLOB(_v)  \
     SQLUDF_CLOB*   out##_v = \
        (SQLUDF_CLOB*)  coz_getNextParmIf(p, argc, argv, 4)


#define inIndy(_v) \
    short *indyIn##_v = \
        (short*) coz_getNextParmIf(p,argc,argv)
#define outIndy(_v) \
    short *indy##_v = \
        (short*) coz_getNextParmIf(p,argc,argv,2)

int main(int argc, char *argv[])
{

    int p = 0;

    _MI_Time       mt;
    time_t         epochTime;
    struct timeval tv;
    int            rc = 0;

    /**********************************************************/
    /* Copyright 1992-2022 by Bob Cozzi, Jr.                   */
    /* All rights reserved.                                   */
    /**********************************************************/

    //////////////////////////////////////////////
    //  INPUT Parameters
    //////////////////////////////////////////////
    inChar(LIB);      // Library name for CMDNAME
    inChar(CMDNAME);  // *CMD name VARCHAR(10)
    inChar(HELPID); // List of Help IDs (parameter KWD names)


    //////////////////////////////////////////////
    //  OUTPUT Fields
    //////////////////////////////////////////////
    outCLOB(CMDXML);


    ////////////////////////////////////////////////////////////
    //  Input Parameters' INDICATORS
    ////////////////////////////////////////////////////////////
    inIndy(LIB);      // Library name
    inIndy(CMDNAME);  // Command name
    inIndy(HELPID);   // List of help IDs

    ////////////////////////////////////////////////////////////
    //  Output Columns' INDICATORS
    ////////////////////////////////////////////////////////////
    outIndy(CMDXML);

    ////////////////////////////////////////////////////////////
    //  SQL specific parameters
    ////////////////////////////////////////////////////////////
    char *sqlstate = (char *)coz_getNextParmIf(p, argc, argv);
    char *funcName = (char *)coz_getNextParmIf(p, argc, argv);
    char *specificName = (char *)coz_getNextParmIf(p, argc, argv);
    char *sqlmsgtext = (char *)coz_getNextParmIf(p, argc, argv);
    char *scratchPad = (char *)coz_getNextParmIf(p, argc, argv);
    int  *sqlOpCode = (int *)coz_getNextParmIf(p, argc, argv);

    ////////////////////////////////////////////////////////////
    //  BEGIN main() body (after parms starts here)
    ////////////////////////////////////////////////////////////

     scratch_t* pScratch = (scratch_t *)scratchPad;
     char*      pBuffer = NULL;
     int        bufLen = 0;
     int        IDcount = 1;
     int        maxOutputLen = 65535;
     char       qualCMD[21];
     coz_qusec ec;

     Qcd_CMDI0100_t  cmdDesc;
     char CMDD_APIFMT[] = "CMDI0100";

     Quh_Ids_To_Rtv_t helpID;
     char HLPD_APIFMT[] = "RHLP0100";

     if (*sqlOpCode == SQLUDF_TF_OPEN)
     {
       // One-Off stuff goes here

       // Initialize Scratch pad
       memset(pScratch, 0x00, sizeof(scratch));

      coz_toUpper(inCMDNAME);
      coz_toUpper(inLIB);
      coz_makeAPIObjName(qualCMD, inCMDNAME, inLIB);
      strcpy(pScratch->cmdName, inCMDNAME);
      memset(&cmdDesc,0x00,sizeof(cmdDesc));
      bufLen = sizeof(cmdDesc);
      ec.init();
      char followProxy = '1';
      QCDRCMDI(&cmdDesc,bufLen,CMDD_APIFMT,
               qualCMD,&ec, &followProxy);

       if (ec.hasError())
       {
         coz_resignalMsg(ec);
         strcpy(sqlstate, "02000");
         pScratch->eof = 1;
         return -1;
       }

        memset((char *)&pScratch->helpID, ' ', sizeof(helpID));
        _CPYBYTES(pScratch->helpID.Help_Id_Name, cmdDesc.Help_Id, sizeof(cmdDesc.Help_Id));
        _CPYBYTES(pScratch->helpID.Object_Name,  cmdDesc.Help_Panel_Name, sizeof(cmdDesc.Help_Panel_Name));
        _CPYBYTES(pScratch->helpID.Object_Lib,   cmdDesc.Help_Panel_Lib_Name,sizeof(cmdDesc.Help_Panel_Lib_Name));
        _CPYBYTES(pScratch->helpID.Object_Type,  "*PNLGRP", 7);

        char* pHelp        = (char*) coz_TEMP_USRSPACE(pScratch->HELPTEXT, "CMDHELP", coz_MAXMEM15M);
        char* pHelpIDArray = (char*) coz_TEMP_USRSPACE(pScratch->HELPID, "CMDHELPID");
        char* pRtnHelpID   = (char*) coz_TEMP_USRSPACE(pScratch->RTNHELPID, "RTNHELPID");
    }
    if (*sqlOpCode == SQLUDF_TF_FETCH && pScratch->eof == 1)
    {
        strcpy(sqlstate, "02000");
        pScratch->eof = 1;
    }

    // ------------------------------------------------------
    // F E T C H   Operation
    // ------------------------------------------------------
    if (*sqlOpCode == SQLUDF_TF_FETCH && pScratch->eof == 0)
    {

      char* pHelpIDArray = (char*) coz_getPtrUsrSpace(pScratch->HELPID);
      char* pHelp        = (char*) coz_getPtrUsrSpace(pScratch->HELPTEXT);
      char *pRtnHelpID   = (char*) coz_getPtrUsrSpace(pScratch->RTNHELPID);
      bufLen = 65535;
      IDcount = 0;  // Number of HelpID tokens found (incremented below)
      maxOutputLen = coz_MAXMEM15M;
      Quh_Ids_To_Rtv_t tokenID;
      int tokenOffset = 0;
      char helpID[32];

      memset((char *)&tokenID, ' ', sizeof(tokenID));
      coz_toUpper(inHELPID);
      // Tokenize inHELPID -- delimiters: blank, comma, or colon
      {
          char  tokenWork[21];
          int   cpyLen     = strlen(inHELPID);
          char *tok = strtok(inHELPID, " ,:");
          _CPYBYTES(tokenID.Object_Name, pScratch->helpID.Object_Name, sizeof(tokenID.Object_Name));
          _CPYBYTES(tokenID.Object_Lib,  pScratch->helpID.Object_Lib,  sizeof(tokenID.Object_Lib));
          _CPYBYTES(tokenID.Object_Type, pScratch->helpID.Object_Type, sizeof(tokenID.Object_Type));
          while (tok != NULL)
          {
            sprintf(helpID, "%s/%s", pScratch->cmdName, tok);
            memset((char *)tokenID.Help_Id_Name, ' ', sizeof(tokenID.Help_Id_Name));
            _CPYBYTES(tokenID.Help_Id_Name, helpID, strlen(helpID));
            _CPYBYTES(pHelpIDArray + tokenOffset, (char*)&tokenID, sizeof(tokenID));

            IDcount++;
            tokenOffset += sizeof(tokenID);

            tok = strtok(NULL, " ,:");
          }
      }

      QUHRHLPT(pRtnHelpID, &bufLen, HLPD_APIFMT, pHelpIDArray, &IDcount, pHelp, &maxOutputLen, &ec);

      if (ec.hasNoError())
      {
        _CPYBYTES(outCMDXML->data, pHelp + (sizeof(int)*2), ((Quh_Help_Id_Txt*)pHelp)->Bytes_Returned);
        outCMDXML->length = ((Quh_Help_Id_Txt *)pHelp)->Bytes_Returned - (sizeof(int)*2);
      }
      pScratch->eof = 1; // Only one row returned so seton our "EOF" flag
    }

    if (*sqlOpCode == SQLUDF_TF_CLOSE)
    {
        coz_DLTOBJ(pScratch->HELPID,    "*USRSPC");
        coz_DLTOBJ(pScratch->HELPTEXT,  "*USRSPC");
        coz_DLTOBJ(pScratch->RTNHELPID, "*USRSPC");
    }
    if (*sqlOpCode == SQLUDF_TF_FINAL ||
        *sqlOpCode == SQLUDF_TF_FINAL_CRA)
    {
        // no final call code for now
    }
}

/* ============================================= */
/* coz_copyPad                                   */
/* Copy s to t, blank-padding to padLen bytes.   */
/* ============================================= */
inline void coz_copyPad(
    char*       t,
    const char* s,
    int         padLen,
    char        padChar)
{
    int slen = (s != NULL) ? (int)strlen(s) : 0;
    memset(t, padChar, padLen);
    if (slen > 0)
        _CPYBYTES(t, s,
                  (slen < padLen) ? slen : padLen);
}


/* ============================================= */
/* coz_DLTOBJ                                    */
/* Delete an IBM i object via QLIDLTO API.       */
/* ============================================= */
inline void coz_DLTOBJ(
    const char* qualObjName,
    const char* objType,
    const char* ASPName)
{
    char szObjType[11];
    char szASP[11];
    char rmvMsg[1] = {'1'};
    coz_qusec ec;
    if (qualObjName == NULL  ||
        qualObjName[0] == ' ' ||
        qualObjName[0] == 0x00)
        return;
    coz_copyPad(szObjType, objType,  10);
    coz_copyPad(szASP,     ASPName,  10);
    ec.init();
    QLIDLTO((char*)qualObjName,
            szObjType, szASP,
            rmvMsg, &ec);
}
/* ============================================= */
/* coz_toUpper / coz_toLower                     */
/* In-place EBCDIC case conversion.              */
/* ============================================= */
inline int coz_toUpper(
    char* szData,
    int   inLen,
    int   ccsid)
{
    Qlg_CCSID_ReqCtlBlk_T frcb;
    coz_qusec ec;
    long len = (inLen <= 0)
               ? (long)strlen(szData) : inLen;
    memset((char*)&frcb, 0x00, sizeof(frcb));
    frcb.Type_of_Request     = 1;
    frcb.Case_Request        = _TOUPPER;
    frcb.CCSID_of_Input_Data = ccsid;
    if (len > 0)
        QlgConvertCase((char*)&frcb,
                       szData, szData,
                       &len, (char*)&ec);
    return (int)len;
}

/* ============================================= */
/* coz_nameUpper                                 */
/* Converts non-quoted IBM i object name to      */
/* upper case in-place.                          */
/* ============================================= */
inline int coz_nameUpper(
    char* szData,
    int   inLen)
{
    const char q = '"';
    int len = (inLen <= 0)
                  ? (int)strlen(szData) : inLen;
    if (szData[0] == q) return inLen;
    return coz_toUpper(szData, len);
}

inline char* coz_getPtrUsrSpace(
    const char* p2PartUsrSpaceName)
{
    void*     pUS = NULL;
    coz_qusec ec;
    ec.init();
    QUSPTRUS((char*)p2PartUsrSpaceName,
             &pUS, &ec);
    if (ec.isEmpty()) return (char*)pUS;
    return NULL;
}

/* ============================================= */
/* coz_TEMP_USRSPACE                             */
/* Create a temporary *USRSPC in QTEMP.          */
/* Returns pointer to user-space data area;      */
/* stores 20-char API name in rtnUSName[20].     */
/* ============================================= */
inline char* coz_TEMP_USRSPACE(
                char*       rtnUSName,
                const char* objAttr,
                int         initSize)
{
    char qualName[21];
    char extAttr[11];
    char pubAut[11];
    char text[51];
    char repl[11];
    char domain[11];
    char initVal = 0x00;
    char* pUS   = NULL;
    coz_qusec ec;
    std::string nm;
    size_t pos = 0;
    memset(qualName, ' ', 20);
    qualName[20] = 0x00;
    nm  = tmpnam(NULL);
    pos = nm.find_last_of("/\\");
    if (pos != std::string::npos)
        nm.erase(0, pos + 1);
    if (nm.length() > 10)
        nm.resize(10);

    coz_makeAPIObjName(
        qualName, nm.c_str(), "QTEMP");

    coz_nameUpper(qualName, 20);

    coz_copyPad(extAttr, objAttr,       10);
    coz_copyPad(pubAut,  "*LIBCRTAUT",  10);
    coz_copyPad(text,
                "SPOOLDATA UDTF Temp Space", 50);
    coz_copyPad(repl,   "*NO",          10);
    coz_copyPad(domain, "*DEFAULT",     10);
    ec.init();
    QUSCRTUS(qualName, extAttr, initSize,
             &initVal, pubAut, text,
             repl, &ec, domain);
    if (ec.isEmpty()) {
        /* Enable auto-extend so the space grows   */
        /* automatically when APIs write past the  */
        /* initial size (e.g. QDBRTVFD).           */
        /* key=3 is AutoExtend; key=1=size,        */
        /* key=2=InitChar, key=4=TransferSize.     */
        typedef _Packed struct {
            int  key;
            int  dataLen;
            union {
                int  size;
                int  transferSize;
                char autoExtend;
                char initValue;
            };
        } coz_spaceKey_t;
        typedef _Packed struct {
            int           count;
            coz_spaceKey_t attr[1];
        } coz_spaceAttr_t;
        coz_spaceAttr_t spaceAttr;
        spaceAttr.count          = 1;
        spaceAttr.attr[0].key     = 3;
        spaceAttr.attr[0].dataLen = 1;
        spaceAttr.attr[0].autoExtend = '1';
        char rtnLib[10];
        memset(rtnLib, ' ', sizeof(rtnLib));
        ec.init();
        QUSCUSAT(rtnLib, qualName, &spaceAttr, &ec);
        /* Non-fatal if QUSCUSAT fails — space     */
        /* will still work, just won't auto-grow.  */
        ec.init();
        QUSPTRUS(qualName, (void**)&pUS, &ec);
    }
    if (pUS != NULL && rtnUSName != NULL)
        _CPYBYTES(rtnUSName, qualName, 20);
    return pUS;
}


/* ============================================= */
/* coz_makeAPIObjName                            */
/* Build 20-char IBM i API object name from      */
/* qualified name (LIB/OBJ or OBJ).              */
/* ============================================= */
inline void coz_makeAPIObjName(
    char*       objName,
    const char* qualObj,
    const char* dftLib)
{
    char OBJNAME[11];
    char LIBNAME[11];
    memset(objName,  ' ', 20);
    memset(OBJNAME,  ' ', sizeof(OBJNAME));
    memset(LIBNAME,  ' ', sizeof(LIBNAME));
    OBJNAME[10] = 0x00;
    LIBNAME[10] = 0x00;
    const char* slashPos = strchr(qualObj, '/');
    if (slashPos != NULL) {
        int len = (int)(slashPos - qualObj);
        int olen = (int)strlen(slashPos + 1);
        if (olen > 10) olen = 10;
        if (len  > 10) len  = 10;
        _CPYBYTES(OBJNAME, slashPos + 1, olen);
        _CPYBYTES(LIBNAME, qualObj,      len);
    } else {
        int olen = (int)strlen(qualObj);
        if (olen > 10) olen = 10;
        _CPYBYTES(OBJNAME, qualObj, olen);
        if (dftLib != NULL) {
            int llen = (int)strlen(dftLib);
            if (llen > 10) llen = 10;
            _CPYBYTES(LIBNAME, dftLib, llen);
        } else {
            _CPYBYTES(LIBNAME, "*LIBL", 5);
        }
    }
    _CPYBYTES(objName,      OBJNAME, 10);
    _CPYBYTES(objName + 10, LIBNAME, 10);
}


/* ============================================= */
/* coz_copyUntil                                 */
/* Copy s to t (null-terminated), stopping at   */
/* maxLen, NUL, or any char in stopAt.           */
/* ============================================= */
inline int coz_copyUntil(
    char*       t,
    const char* s,
    int         maxLen,
    const char* stopAt,
    bool        bTrim)
{
    int bStop  = 0;
    int rtnLen = 0;
    int i      = 0;
    if (t == NULL || s == NULL) return 0;
#pragma exception_handler(coz_cu_exc,\
    0, 0,\
    _C2_MH_ESCAPE | _C2_MH_FUNCTION_CHECK,\
    _CTLA_HANDLE)
    memset(t, ' ', maxLen);
    while (s[i] != 0x00 && i < maxLen) {
        if (stopAt != NULL) {
            size_t j;
            for (j = 0; j < strlen(stopAt); j++) {
                if (s[i] == stopAt[j]) {
                    bStop = 1;
                }
            }
        }
        if (bStop) break;
        t[i] = s[i];
        i++;
    }
    if (bTrim) {
        t[i] = 0x00;
        if (i > 0)
            t[::triml(t, ' ')] = 0x00;
        rtnLen = (int)strlen(t);
    } else {
        rtnLen = i;
    }
#pragma disable_handler
    return rtnLen;
coz_cu_exc:;
    return rtnLen;
}

/* ============================================= */
/* coz_resignalMsg                               */
/* Re-send an IBM i API error as a program msg.  */
/* ============================================= */
inline void coz_resignalMsg(coz_qusec& ec)
{
    char msgfile[21];
    char msgtype[11];
    char msgkey[4];
    char topgmq[11];
    char msgPrefix[3];
    char msgType[3];
    qusec_t  fc;
    memset((char*)&fc, 0x00, sizeof(fc));
    fc.Bytes_Provided = sizeof(fc);
    memset(msgkey,  ' ', sizeof(msgkey));
    memset(msgfile, ' ', sizeof(msgfile));
    memset(topgmq,  ' ', sizeof(topgmq));
    coz_copyPad(topgmq, "*", 10);
    if (ec.isEmpty()) return;
    _CPYBYTES(msgPrefix, ec.msgid(), 2);
    _CPYBYTES(msgType,   ec.msgid() + 2, 1);
    msgType[1]   = 0x00;
    msgPrefix[2] = 0x00;
    if (strcmp(msgPrefix, "CP") == 0)
        coz_makeAPIObjName(msgfile,
                           "QCPFMSG", "*LIBL");
    else if (strcmp(msgPrefix, "RN") == 0)
        coz_makeAPIObjName(msgfile,
                           "QRPGLEMSG","QDEVTOOLS");
    else if (strcmp(msgPrefix, "HT") == 0)
        coz_makeAPIObjName(msgfile,
                           "QHTTPMSG", "QHTTPSVR");
    else if (strcmp(msgPrefix, "CE") == 0)
        coz_makeAPIObjName(msgfile,
                           "QCEEMSG", "QSYS");
    else if (strcmp(msgPrefix, "GU") == 0)
        coz_makeAPIObjName(msgfile,
                           "QGUIMSG",  "QSYS");
    else if (strcmp(msgPrefix, "IW") == 0)
        coz_makeAPIObjName(msgfile,
                           "QIWSMSG",  "QSYS");
    else
        coz_makeAPIObjName(msgfile,
                           "QCPFMSG",  "*LIBL");
    switch (msgType[0]) {
        case 'F': case 'I':
            coz_copyPad(msgtype, "*INFO", 10);
            break;
        case 'E':
            coz_copyPad(msgtype, "*ESCAPE", 10);
            break;
        case 'D':
            coz_copyPad(msgtype, "*DIAG", 10);
            break;
        case 'C':
            coz_copyPad(msgtype, "*COMP", 10);
            break;
        default:
            coz_copyPad(msgtype, "*INFO", 10);
            break;
    }
    QMHSNDPM(ec.msgid(), msgfile,
             ec.msgdata(),
             ec.getMsgDataLen(),
             msgtype, topgmq, 1,
             msgkey, &fc);
}


/* ============================================= */
/* coz_getNextParmIf                             */
/* Advance parameter counter and return argv[n]. */
/* If ioFlag>0, memset output parm to 0x00.      */
/* ============================================= */
inline char* coz_getNextParmIf(
    int&  pC,
    int&  argc,
    char** argv,
    int   ioFlag)
{
    char* pRtn = NULL;
    if (argc > pC + 1) {
        pRtn = argv[++pC];
        if (ioFlag > 0)
            memset(pRtn, 0x00, ioFlag);
    }
    return pRtn;
}
#pragma datamodel(pop)
`;
}
