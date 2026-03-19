import path from "path";

function getPaths(functionId: string) {
    const baseExtractDir = path.resolve("extracted");

    return {
        functionId,

        outputDir: path.join(baseExtractDir, functionId),

        apiSock: `/tmp/firecracker-${functionId}.socket`,
        vsock: `/tmp/vsock-${functionId}.sock`,

        rootfs: path.resolve(`rootfs/rootfs-${functionId}.ext4`),

        snapshot: path.resolve(`snapshot/snapshot-${functionId}`),
        memory: path.resolve(`mem/mem-${functionId}`),

        kernel: path.resolve("vmlinux-6.1.155"),
    };
}