<template>
    <progress v-if="processing" class="progress is-small is-primary my-4" :value="progress" max="100" />
    <div class="container is-max-desktop" id="bottom">
      <div class="columns is-gapless">
        <DropDown class="column" :options="['200', '400']" @clicked="cellSize = $event">
          <template v-slot:selected>
            <span>{{size*cellSize}}x{{size*cellSize}}</span>
          </template>
          <template v-slot:option="slotProps">
            {{size*parseInt(slotProps.option)}}x{{size*parseInt(slotProps.option)}}
          </template>
        </DropDown>
        <DropDown class="column" :options="['no-denoise', 'conservative', 'denoise1x', 'denoise2x', 'denoise3x', 'pro-no-denoise', 'pro-conservative', 'pro-denoise3x']" @clicked="denoise = $event" :disabled="cellSize == 200">
          <template v-slot:selected>
            <span>{{denoise}}</span>
          </template>
          <template v-slot:option="slotProps">
            {{slotProps.option}}
          </template>
        </DropDown>
        <DropDown class="column" :options="workerList" @clicked="workers = $event" title="Max number of workers used when upscaling images" :disabled="cellSize == 200">
          <template v-slot:selected>
              <span >{{workers}}</span>
          </template>
          <template v-slot:option="slotProps">
            Upscale workers: {{slotProps.option}}
          </template>
        </DropDown>
        <DropDown class="column" :options="['image/jpeg', 'image/png', 'image/webp']" @clicked="download($event)">
          <template v-slot:selected>
            <span v-if='processing'>{{progress_msg}}</span>
            <span v-else>Download</span>
          </template>
          <template v-slot:option="slotProps">
            Download ({{slotProps.option}})
          </template>
        </DropDown>
        <DropDown class="column" :options="['2', '3', '4', '5']" @clicked="updateSize($event)">
          <template v-slot:selected>
              <span >{{size}}x{{size}}</span>
          </template>
          <template v-slot:option="slotProps">
            {{slotProps.option}}x{{slotProps.option}}
          </template>
        </DropDown>
        <div class="column">
          <button class="button is-small" @click="select_color = !select_color">Border</button>
          <div v-if="select_color">
            <input class="button is-small" type="color" id="color" :value="color" @input="updateColor($event)">
            <input class="is-small" type="range" :value="alpha" @input="updateAlpha($event)" />
          </div>
        </div>
        <div class="column">
          <a href="https://github.com/gqgs/3x3-generator" target="_blank">
          <ion-icon class="pt-3" id="github" name="logo-octocat"></ion-icon>
          </a>
        </div>
      </div>
    </div>
</template>

<style scoped>
#bottom {
  max-width: 550px;
}

#color {
  width: 100%
}

.column {
  padding: 10px 2px;
}

@media (max-width: 768px) {
  #color {
    width: 150px;
  }

  .column {
    padding: 5px;
  }
}

</style>

<script lang="ts">
import { ref, defineComponent, watch } from "vue"
import { mapState } from "vuex"
import { useStore } from "../store"
import fileDownload from "js-file-download"
import { scaleImage } from "../image"
import DropDown from "./DropDown.vue"
import { Upscaler } from "upscalejs"
import type { Model as DenoiseModel } from "upscalejs"

export default defineComponent({
  components: {
    DropDown
  },
  setup () {
    // eslint-disable-next-line
    // @ts-ignore
    const isMobile = navigator?.userAgentData?.mobile || false
    const max_workers = navigator.hardwareConcurrency
    const store = useStore()
    const cellSize = ref<number>(JSON.parse(localStorage.getItem("cellSize") || "400"))
    const workers = ref<number>(JSON.parse(localStorage.getItem("workers") || (isMobile ? "1" : max_workers.toString())))
    const updateSize = (size: number) => store.dispatch("updateSize", size)
    const updateColor = (event: Event) => store.dispatch("updateColor", (event.target as HTMLInputElement).value)
    const updateAlpha = (event: Event) => store.dispatch("updateAlpha", (event.target as HTMLInputElement).value)
    const denoise = ref(localStorage.getItem("denoise:v2") || "denoise1x")
    const progress = ref(0)
    const progress_msg = "Creating image..."
    const processing = ref(false)
    const select_color = ref(false)

    watch(denoise, (denoise) => {
      store.state.cached_source = null
      localStorage.setItem("denoise:v2", denoise)
    })

    watch(cellSize, (cellSize) => {
      store.state.cached_source = null
      localStorage.setItem("cellSize", JSON.stringify(cellSize))
    })

    watch(workers, (workers) => {
      localStorage.setItem("workers", JSON.stringify(workers))
    })

    const drawImages = async (denoiseModel: string): Promise<HTMLCanvasElement> => {
      const imageSize = cellSize.value
      const size = store.state.size
      const images = store.state.images
      const canvas = document.createElement("canvas")
      canvas.width = size * imageSize
      canvas.height = size * imageSize
      const ctx = canvas.getContext("2d")
      if (!ctx) throw new Error("could not get canvas context")
      ctx.strokeStyle = store.getters.color

      const workerPool = new Upscaler({
        maxWorkers: workers.value,
        maxInternalWorkers: 1,
        denoiseModel: denoiseModel as DenoiseModel,
      })

      const upscaleFunc = () => {
        let i = 0
        return async (image: ImageBitmap): Promise<ImageBitmap> => {
          const result = await scaleImage(image, imageSize, workerPool)
          progress.value = (++i) / Object.keys(images).length * 100
          return result
        }
      }
      const upscale = upscaleFunc()
      const upscale_jobs = new Map<string, Promise<ImageBitmap>>()
      
      // Use the bitmap from the new state structure
      for (const i of Object.keys(images)) {
        if (images[i]?.bitmap) {
          upscale_jobs.set(i, upscale(images[i].bitmap))
        }
      }
      await Promise.all(Object.values(upscale_jobs))

      for (let x = 0, i = 1; x < size; x++) {
        for (let y = 0; y < size; y++, i++) {
          const upscaled = upscale_jobs.get(i.toString())
          if (upscaled) {
            ctx.drawImage(await upscaled, 0, 0, imageSize, imageSize, y * imageSize, x * imageSize, imageSize, imageSize)
            ctx.strokeRect(y * imageSize, x * imageSize, imageSize, imageSize)
          }
        }
      }
      workerPool.terminate()
      return canvas
    }

    const download = async (mimeType: string) => {
      if (!store.state.cached_source) {
        progress.value = 0
        processing.value = true
        store.state.cached_source = await drawImages(denoise.value)
        processing.value = false
      }
      const size = store.state.size
      store.state.cached_source.toBlob(blob => {
        if (blob == null) return
        let filename = `${size}x${size}`
        switch (mimeType) {
          case "image/png":
            filename = `${filename}.png`
            break
          case "image/webp":
            filename = `${filename}.webp`
            break
          default:
            filename = `${filename}.jpg`
        }
        fileDownload(blob, filename)
      }, mimeType)
    }

    const workerList = [...Array(max_workers).keys()].map(key => (key+1).toString())

    return {
      download,
      cellSize,
      progress,
      progress_msg,
      denoise,
      updateSize,
      updateColor,
      updateAlpha,
      processing,
      workers,
      workerList,
      select_color
    }
  },
  computed: {
    ...mapState([
      "size",
      "images",
      "color",
      "alpha"
    ])
  }
})
</script>
