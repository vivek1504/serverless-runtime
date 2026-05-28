import extract from "extract-zip";
import { exec as execCb, spawn } from "child_process";
import { promisify } from "util";
import { rootfsLogger } from "../utils/logger.js";

const exec = promisify(execCb);

export async function extractZip(zip: string, outputDir: string) {
  rootfsLogger.debug({ zip, outputDir }, "extracting zip archive");

  await extract(zip, {
    dir: outputDir,
    onEntry: (entry) => {
      if (entry.fileName.includes("..")) {
        rootfsLogger.error(
          { fileName: entry.fileName },
          "path traversal detected in zip — aborting",
        );
        throw new Error("Invalid zip content");
      }
    },
  });

  rootfsLogger.debug({ zip, outputDir }, "zip extraction completed");
}

export async function prepareRootfs(functionId: string) {
  const baseImage = "rootfs.ext4";
  const image = `rootfs/rootfs-${functionId}.ext4`;

  rootfsLogger.debug({ functionId, baseImage, image }, "copying base rootfs image");
  await exec(`cp --reflink=auto ${baseImage} ${image}`);

  const mountDir = `/mnt/rootfs-${functionId}`;
  const extracted = `extracted/${functionId}`;

  await exec(`sudo mkdir -p ${mountDir}`);
  rootfsLogger.debug({ functionId, mountDir, image }, "mounting rootfs image");
  await exec(`sudo mount -o loop ${image} ${mountDir}`);

  rootfsLogger.debug({ functionId, from: extracted, to: `${mountDir}/app/` }, "copying user code into rootfs");
  await exec(`sudo cp -r ${extracted}/. ${mountDir}/app/`);

  await exec(`sudo umount ${mountDir}`);
  await exec(`sudo rm -rf ${mountDir}`);
  rootfsLogger.debug({ functionId, image }, "rootfs prepared and unmounted");

  return image;
}
