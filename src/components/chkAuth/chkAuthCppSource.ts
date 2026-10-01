/**
 * Embedded source for CHK_AUTH.CPP.
 *
 * Source origin: /Users/cozzi/Downloads/projects/open-UDTF/src/CHK_AUTH/CHK_AUTH.CPP
 * Stored as plain text (no base64 encoding).
 */
export function getChkAuthCPPSrc(): string {
    return String.raw`// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 1996-2026 by R. Cozzi, Jr.


  // @author BobCozzi

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
#include <string.h>
#include <errno.h>
#include <ctype.h>
#include <inttypes.h>


#include <langinfo.h>
#include <QP0LSTDI.h>
#include <QP0ZTRC.h>
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

#include <QSYCUSRA.h>

  // include syntax when compiling from an IFS stream file
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

const int MAXUSRSPACESIZE = 16711568;
const int MAXMEM15M = 15662992;
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
    union { int  Bytes_Provided; int  length; };
    union { int  Bytes_Available; int  Bytes_Returned; };
    union { char Exception_Id[7]; char msgid[7]; };
    char Reserved;
    union { char Exception_Data[255]; char msgdta[255]; };
 } qusec_t;


class qusec {
public:
    qusec() { init(); }
    void init() {
        memset((char*)&ec, 0x00,
               sizeof(ec) + sizeof(xtra));
        ec.Bytes_Provided =
            (int)(sizeof(ec) + sizeof(xtra));
    }
    void clear() {
        memset((char*)&ec, 0x00,sizeof(ec) + sizeof(xtra));
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
    bool startsWith(const char* prefix) {
        return strncmp(ec.Exception_Id, prefix, std::min<int>(7,std::strlen(prefix))) == 0;
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

/* ============================================= */
/* Helper function prototypes                    */
/* ============================================= */
inline void  copyPad(char* t, const char* s, int padLen = 10, char padChar = ' ');
inline int   copyUntil(char* t, const char* s, int maxLen = 10, const char* stopAt = NULL, bool bTrim = false);
inline int   toUpper(char* szData, int inLen = -1, int ccsid = 0);
inline int   nameUpper(char* szData, int inLen = -1);

inline void  makeAPIObjName(char* objName, const char* qualObj, const char* dftLib = "*LIBL");
inline void  resignalMsg(qusec& ec);

inline char* getNextParmIf(int& pC, int& argc, char** argv, int ioFlag = 0);

#define inChar(_v) \
          char *in##_v = \
          (char*) getNextParmIf(p,argc,argv)
#define inInt(_v)  \
          int   *in##_v = (int *) getNextParmIf(p, argc, argv)
#define inShort(_v) \
          short *in##_v = (short *) getNextParmIf(p, argc, argv)
#define inSmallInt(_v) \
          short *in##_v = \
              (short *) getNextParmIf(p, argc, argv)
#define inBigInt(_v)   \
           long long *in##_v = \
              (long long *) getNextParmIf(p, argc, argv)

#define outChar(_v) \
           char  *out##_v = \
           (char *) getNextParmIf(p, argc, argv, 1)
#define outCLOB(_v)  \
     SQLUDF_CLOB*   out##_v = \
        (SQLUDF_CLOB*)  getNextParmIf(p, argc, argv, 4)
#define outInt(_v) \
           int   *out##_v = \
           (int *) getNextParmIf(p, argc, argv)

#define inIndy(_v) \
    short *indyIn##_v = \
        (short*) getNextParmIf(p,argc,argv)
#define outIndy(_v) \
    short *indy##_v = \
        (short*) getNextParmIf(p,argc,argv,2)

int main(int argc, char *argv[])
{
   int p = 0;

   _MI_Time       mt;
   time_t         epochTime;
   struct timeval tv;
   int            rc = 0;
   qusec      ec;


    //////////////////////////////////////////////
    //  INPUT Parameters
    //////////////////////////////////////////////
    inChar(LIBNAME);      // Library name for OBJNAME
    inChar(OBJNAME);  // Object nmae
    inChar(OBJTYPE);  // Object type (e.g., *FILE, *LIB, *CMD)

    inChar(AUTH);     // List of Authorizations to check
    inChar(USERNAME); // User Name (default *CURRENT)
    inChar(CALLLVL);  // Call Level to check Dft=*SAME

    //////////////////////////////////////////////
    //  OUTPUT Fields
    //////////////////////////////////////////////
    outInt(AUTHORIZED);  // 1=Authorized, 0 = Not Authorized


    ////////////////////////////////////////////////////////////
    //  Input Parameters' INDICATORS
    ////////////////////////////////////////////////////////////
    inIndy(LIB);      // Library name for OBJNAME
    inIndy(OBJNAME);  // Object nmae
    inIndy(OBJTYPE);  // Object type (e.g., *FILE, *LIB, *CMD)
    inIndy(AUTH);     // LIst of Authorizations to check
    inIndy(USERNAME); // User Name (default *CURRENT)
    inIndy(CALLLVL);  // Call level to check

    ////////////////////////////////////////////////////////////
    //  Output Columns' INDICATORS
    ////////////////////////////////////////////////////////////
    outIndy(AUTHORIZED);

    ////////////////////////////////////////////////////////////
    //  SQL specific parameters
    ////////////////////////////////////////////////////////////
   char *sqlstate = (char *) getNextParmIf(p, argc, argv);
   char *funcName = (char *) getNextParmIf(p, argc, argv);
   char *specificName = (char *) getNextParmIf(p, argc, argv);
   char *sqlmsgtext = (char *) getNextParmIf(p, argc, argv);


   char qualObj[21];
   char objType[11];
   char userName[11];
   char authorizedFlag[1];
   int  authCount = 0;
   char authority[196];
   int  callLevel = 0;
   const int authSize = 10;
   int  nextAuth = 0;
   int  nextIndex = 0;

   nameUpper(inOBJNAME);
   nameUpper(inLIBNAME);
   toUpper(inOBJTYPE);
   toUpper(inAUTH);
   toUpper(inUSERNAME);

   makeAPIObjName(qualObj, inOBJNAME, inLIBNAME);
   if (*indyInUSERNAME >= 0 && strlen(inUSERNAME) > 0)
   {
      copyPad(userName, inUSERNAME);
   }
   else
   {
      copyPad(userName,"*CURRENT");
   }

   if (*indyInOBJTYPE < 0 || strlen(inOBJTYPE) == 0)
   {
      copyPad(objType, "*FILE");
   }
   else if (inOBJTYPE[0] != '*')
   {
      objType[0] = '*';
      copyPad(objType+1,  inOBJTYPE,9);
   }
   else
   {
      copyPad(objType,  inOBJTYPE);
   }

   if (*indyInCALLLVL >= 0)
   {
      toUpper(inCALLLVL);
      if (inCALLLVL[0] == '*') inCALLLVL++; // skip leading '*'
      if (strcmp(inCALLLVL,"PRV")==0) callLevel = 1;
      else if (strcmp(inCALLLVL,"SAME")==0) callLevel = 0;
      else {
         // Check if inCALLLVL contains only digits and assign to callLevel
         callLevel = 0;
         bool hasDigits = false;
         size_t len = strlen(inCALLLVL);
         for (size_t i = 0; i < len; ++i) {
            if (isdigit((unsigned char)inCALLLVL[i])) {
               hasDigits = true;
            } else if (!isspace((unsigned char)inCALLLVL[i])) {
               hasDigits = false;
               break;
            }
         }
         if (hasDigits) {
            callLevel = atoi(inCALLLVL);
         }
      }
   }
   char* token = strtok(inAUTH, " ,:;");
   while (token != NULL)
   {
      nextIndex = nextAuth;
      if (token[0] == '*') {  // Doesn't have leading '*'?
        token++; // Skip the leading '*'
      }
      authority[nextIndex] = '*';
      if (strcmp(token,"WRITE")==0)
      {
         copyPad(authority + (1+nextIndex), "ADD");
      }
      else if (strcmp(token,"UPDATE")==0)
      {
         copyPad(authority + (1+nextIndex), "UPD");
      }
      else if (strcmp(token,"DEL")==0 || strcmp(token,"DELETE")==0)
      {
         copyPad(authority + (1+nextIndex), "DLT");
      }
      else if (strcmp(token,"EXEC")==0 || strcmp(token,"RUN")==0)
      {
         copyPad(authority + (1+nextIndex), "EXECUTE");
      }
      else
      {
          copyPad(authority + (1+nextIndex), token);
      }

      authCount++;
      nextAuth += authSize;
      token = strtok(NULL, " ,:");
   }

   if (authCount <= 0)
   {
      copyPad(authority, "*USE");  // Default AUTH=>'*USE'
   }
   ec.init();
   QSYCUSRA(authorizedFlag, userName, qualObj, objType,
            authority, &authCount,
            &callLevel, &ec);

  if (ec.hasError())
  {
    *outAUTHORIZED = 0;
    if (ec.compare("CPF98"))
    {
       if (ec.compare("CPF9801"))  // Object Not Found
       {
           *outAUTHORIZED = -1;
       }
       else if (ec.compare("CPF981"))  // CPF981x - specific device/library Not Found
       {
           *outAUTHORIZED = -1;
       }
       else if (ec.compare("CPF9802") || ec.compare("CPF9820"))  // Not Authorized
       {
           *outAUTHORIZED = 0;
       }
    }
    resignalMsg( ec );
  }
  else
  {
     *outAUTHORIZED = (authorizedFlag[0] == 'Y' ? 1 : 0);
  }

}

// Helper Function implementation (inlined code)

/* ============================================= */
/* copyPad                                   */
/* Copy s to t, blank-padding to padLen bytes.   */
/* ============================================= */
inline void copyPad(
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
/* toUpper / toLower                     */
/* In-place EBCDIC case conversion.              */
/* ============================================= */
inline int toUpper(
    char* szData,
    int   inLen,
    int   ccsid)
{
    Qlg_CCSID_ReqCtlBlk_T frcb;
    qusec ec;
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
/* nameUpper                                 */
/* Converts non-quoted IBM i object name to      */
/* upper case in-place.                          */
/* ============================================= */
inline int nameUpper(
    char* szData,
    int   inLen)
{
    const char q = '"';
    int len = (inLen <= 0)
                  ? (int)strlen(szData) : inLen;
    if (szData[0] == q) return inLen;
    return toUpper(szData, len);
}

inline char* getPtrUsrSpace(
    const char* p2PartUsrSpaceName)
{
    void*     pUS = NULL;
    qusec ec;
    ec.init();
    QUSPTRUS((char*)p2PartUsrSpaceName,
             &pUS, &ec);
    if (ec.isEmpty()) return (char*)pUS;
    return NULL;
}


/* ============================================= */
/* makeAPIObjName                            */
/* Build 20-char IBM i API object name from      */
/* qualified name (LIB/OBJ or OBJ).              */
/* ============================================= */
inline void makeAPIObjName(
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
/* copyUntil                                 */
/* Copy s to t (null-terminated), stopping at   */
/* maxLen, NUL, or any char in stopAt.           */
/* ============================================= */
inline int copyUntil(
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
#pragma exception_handler( cu_exc,\
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
 cu_exc:;
    return rtnLen;
}

/* ============================================= */
/* resignalMsg                               */
/* Re-send an IBM i API error as a program msg.  */
/* ============================================= */
inline void resignalMsg(qusec& ec)
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
    copyPad(topgmq, "*", 10);
    if (ec.isEmpty()) return;
    _CPYBYTES(msgPrefix, ec.msgid(), 2);
    _CPYBYTES(msgType,   ec.msgid() + 2, 1);
    msgType[1]   = 0x00;
    msgPrefix[2] = 0x00;
    if (strcmp(msgPrefix, "CP") == 0)
        makeAPIObjName(msgfile,
                           "QCPFMSG", "*LIBL");
    else if (strcmp(msgPrefix, "RN") == 0)
        makeAPIObjName(msgfile,
                           "QRPGLEMSG","QDEVTOOLS");
    else if (strcmp(msgPrefix, "HT") == 0)
        makeAPIObjName(msgfile,
                           "QHTTPMSG", "QHTTPSVR");
    else if (strcmp(msgPrefix, "CE") == 0)
        makeAPIObjName(msgfile,
                           "QCEEMSG", "QSYS");
    else if (strcmp(msgPrefix, "GU") == 0)
        makeAPIObjName(msgfile,
                           "QGUIMSG",  "QSYS");
    else if (strcmp(msgPrefix, "IW") == 0)
        makeAPIObjName(msgfile,
                           "QIWSMSG",  "QSYS");
    else
        makeAPIObjName(msgfile,
                           "QCPFMSG",  "*LIBL");
    switch (msgType[0]) {
        case 'F': case 'I':
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


/* ============================================= */
/* getNextParmIf                             */
/* Advance parameter counter and return argv[n]. */
/* If ioFlag>0, memset output parm to 0x00.      */
/* ============================================= */
inline char* getNextParmIf(
    int&  pC,
    int&  argc,
    char** argv,
    int    ioFlag)
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
