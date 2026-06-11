#include <stdio.h>
#include "phonon.h"
int main() {
    IPLContextSettings settings = {0};
    settings.version = STEAMAUDIO_VERSION;
    IPLContext ctx = NULL;
    IPLerror err = iplContextCreate(&settings, &ctx);
    printf("err=%d ctx=%p\n", err, ctx);
    if (ctx) iplContextRelease(&ctx);
    return 0;
}
