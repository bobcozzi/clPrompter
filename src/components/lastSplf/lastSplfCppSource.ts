/**
 * Embedded source for LAST_SPLF.CPP.
 *
 * Source origin: /Users/cozzi/Downloads/projects/open-UDTF/src/LAST_SPLF/LAST_SPLF.CPP
 * Stored as plain text (no base64 encoding).
 */
export function getLastSplfCPPSrc(): string {
    return String.raw`// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 1996-2026 by R. Cozzi, Jr.

// @author BobCozzi

#ifndef __STDC_WANT_DEC_FP__
#define __STDC_WANT_DEC_FP__
#endif

#ifndef __POSIX_LOCALE__
#define __POSIX_LOCALE__
#endif

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
#include <QP0ZTRC.h>     // Qp0zLprintf

#include <sys/stat.h>
#include <sys/types.h>

#include <time.h>
#include <errno.h>
#include <ctype.h>
#include <inttypes.h>
#include <except.h>
#include <decimal.h>

#include <iconv.h>
#include <QTQICONV.h>

#include <LECOND.h>

#include <QSPRILSP.h>

#include <mih/micommon.h>
#include <mih/matpgmnm.h>
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


#define isEmpty(_s) ((::triml( _s, ' ')==0) ? 1 : 0)
#define trimStg(__s) \
        __s[ triml( __s, ' ') ] = 0x00

#define inChar(_v) \
    char *in##_v = \
        (char *)getNextParmIf(p, argc, argv)
#define inInt(_v) \
    int *in##_v = (int *)getNextParmIf(p, argc, argv)

#define outChar(_v) \
    char *out##_v = \
        (char *)getNextParmIf(p, argc, argv, 1)

#define outInt(_v) \
    int *out##_v = \
        (int *)getNextParmIf(p, argc, argv, 4)

#define outSmallInt(_v) \
    short *out##_v =    \
        (short *)getNextParmIf(p, argc, argv, 2)

#define inIndy(_v)      \
    short *indyIn##_v = \
        (short *)getNextParmIf(p, argc, argv, 2)

#define outIndy(_v)   \
    short *indy##_v = \
        (short *)getNextParmIf(p, argc, argv, 2)

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
        char msgdata[255];
    };
} qusec_t;


/* ============================================= */
/* Helper function prototypes                    */
/* ============================================= */
inline int copyUntil(char *t, const char *s, int maxLen = 10, const char *stopChars = NULL, bool bTrim = true);
inline char *getNextParmIf(int &pC, int &argc, char **argv, int ioFlag = 0);

typedef _Packed struct tagScratch
{
    int  length;          // Scratch Pad length
    int  eof;             // End of File flag
    Qsp_SPRL0100_t splfInfo;
} scratch_t;

scratch_t scratch;

int main(int argc, char *argv[])
{
    int p = 0;

    _MI_Time mt;
    time_t epochTime;

    //////////////////////////////////////////////
    //  INPUT Parameters
    //////////////////////////////////////////////
    inChar(SCOPE);    // (*JOB or *USER)

    //////////////////////////////////////////////
    //  OUTPUT Columns for DSPFFD
    //  These mirror the members of Qdb_Lfld_FLDL0300_t.
    //////////////////////////////////////////////
    outChar(SPLFNAME);
    outInt(SPLNBR);
    outChar(JOB);       // 28-byte 3-part job Identifier
    outChar(JOBNAME);   // 10-byte job name
    outChar(JOBUSER);   // 10-byte job user name
    outChar(JOBNBR);    // 6-byte job number
    outChar(SYSNAME);   // 8-Byte partition name
    outChar(CRTDTS);   // Creation or OPEN Date


    //////////////////////////////////////////////
    //  Input Parameter Indicators
    //////////////////////////////////////////////
    inIndy(SCOPE);

    //////////////////////////////////////////////
    //  Output Column Indicators
    //////////////////////////////////////////////
   outIndy(SPLFNAME);
   outIndy(SPLNBR);
   outIndy(JOB);       // 28-byte 3-part job Identifier
   outIndy(JOBNAME);   // 10-byte job name
   outIndy(JOBUSER);   // 10-byte job user name
   outIndy(JOBNBR);    // 6-byte job number
   outIndy(SYSNAME);   // 8-Byte partition name
   outIndy(CRTDTS);   // Creation or OPEN Date

    //////////////////////////////////////////////
    //  SQL-specific scratch parameters
    //////////////////////////////////////////////
   char* sqlstate     = (char *)getNextParmIf(p, argc, argv);
   char* sqlfuncName  = (char *)getNextParmIf(p, argc, argv);
   char* specificName = (char *)getNextParmIf(p, argc, argv);
   char* sqlmsgtext   = (char *)getNextParmIf(p, argc, argv);
   char* scratchPad   = (char *)getNextParmIf(p, argc, argv);
   int*  sqlOpCode    = (int *) getNextParmIf(p, argc, argv);

    ////////////////////////////////////////////////////////////
    //  BEGIN main() body (after parms starts here)
    ////////////////////////////////////////////////////////////

   scratch_t *pScratch = (scratch_t *)scratchPad;

   char *pBuffer = NULL;
   char FMTAPI[] = "SPRL0100";
   qusec_t ec;

   if (*sqlOpCode == SQLUDF_TF_OPEN)
   {
      // one-time STUFF GOES HERE

      // Initialize Scratch pad
      int len = pScratch->length;
      memset(pScratch, 0x00, sizeof(scratch));
      pScratch->length = len;


      memset(&ec, 0x00, sizeof(ec));
      ec.Bytes_Provided = sizeof(ec);

      // Retrieve SPLF Info
      QSPRILSP(&pScratch->splfInfo, sizeof(Qsp_SPRL0100_t) , "SPRL0100", &ec);

     if (ec.Bytes_Returned > 0)
     {
        strcpy(sqlstate,"02000");
        pScratch->eof = 1;
        return 0;
     }
   }
   if (pScratch->eof==1)
   {
         strcpy(sqlstate,"02000");
         return 0;
   }

   if (*sqlOpCode == SQLUDF_TF_FETCH && pScratch->eof == 0)
   {
      char  jobName[11];
      char  jobNbr[7];
      char  jobUser[11];
      Qsp_SPRL0100_t SPLF;
      memset(jobName,0x00,sizeof(jobName));
      memset(jobUser,0x00,sizeof(jobUser));
      memset(jobNbr,0x00,sizeof(jobNbr));

      *outSPLNBR = pScratch->splfInfo.Splf_Number;
      copyUntil(outSPLFNAME,pScratch->splfInfo.Splf_Name);
      copyUntil(outJOBNAME,pScratch->splfInfo.Job_Name);
      copyUntil(outJOBNBR,pScratch->splfInfo.Job_Number, 6);
      copyUntil(outJOBUSER,pScratch->splfInfo.Usr_Name);
      copyUntil(outSYSNAME,pScratch->splfInfo.Job_System_Name, 8);

      _CPYBYTES(jobName,pScratch->splfInfo.Job_Name,sizeof(SPLF.Job_Name));
      trimStg(jobName);
      _CPYBYTES(jobNbr,pScratch->splfInfo.Job_Number,sizeof(SPLF.Job_Number));
      trimStg(jobNbr);
      _CPYBYTES(jobUser,pScratch->splfInfo.Usr_Name,sizeof(SPLF.Usr_Name));
      trimStg(jobUser);
      memset(outJOB,0x00,28);
      sprintf(outJOB,"%.6s/%.10s/%.10s",jobNbr,jobUser,jobName);
      memset(outCRTDTS,0x00,26);
      // Timestamp(0) (no micro/milli seconds)
      sprintf(outCRTDTS,"20%.02s-%.02s-%.02s-%.02s.%.02s.%.02s",
                              pScratch->splfInfo.Date_File_Open+1,
                              pScratch->splfInfo.Date_File_Open+3,
                              pScratch->splfInfo.Date_File_Open+5,
                              pScratch->splfInfo.Time_File_Open,
                              pScratch->splfInfo.Time_File_Open+2,
                              pScratch->splfInfo.Time_File_Open+4);
      pScratch->eof = 1;
   }

   return 0;
}



/* ============================================= */
/* coz_getNextParmIf                             */
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

/* ============================================= */
/* coz_copyUntil                                 */
/* Copy s to t (null-terminated), stopping at   */
/* maxLen, NUL, or any char in stopAt.           */
/* ============================================= */
int copyUntil(
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
`;
}
