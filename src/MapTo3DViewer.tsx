import { useState, useRef, useEffect } from 'react';
import { Upload, RotateCcw, Download } from 'lucide-react';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
// @ts-ignore - pako types are available but not being recognized
import pako from 'pako';

type FeatureType = 'TERRAIN' | 'ROAD' | 'BUILDING';

interface PixelInfo {
  r: number;
  g: number;
  b: number;
  a: number;
  feature: FeatureType;
  rawHeight: number;
}

type ImageState = HTMLImageElement | null;

export default function MapTo3DViewer() {
  const [image, setImage] = useState<ImageState>(null);
  const [heightScale, setHeightScale] = useState<number>(30);
  const [segments, setSegments] = useState<number>(1185); // Default to half of max (2370/2)
  const [invertHeight, setInvertHeight] = useState<boolean>(true);
  const [removeText, setRemoveText] = useState<boolean>(false);
  const [yPosition, setYPosition] = useState<number>(0);
  const [textureSmoothing, setTextureSmoothing] = useState<number>(1);
  const [vertexSmoothing, setVertexSmoothing] = useState<number>(0);
  const [brightness, setBrightness] = useState<number>(1);
  const [contrast, setContrast] = useState<number>(1);
  const [metalness, setMetalness] = useState<number>(0);
  const [roughness, setRoughness] = useState<number>(0.7);
  const [tiltX, setTiltX] = useState<number>(0); // -Math.PI/4 to Math.PI/4 (-45° to 45°)
  const [tiltZ, setTiltZ] = useState<number>(0); // -Math.PI/4 to Math.PI/4 (-45° to 45°)

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const animationRef = useRef<number | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e: ProgressEvent<FileReader>) => {
      if (!e.target?.result) return;
      const img = new Image();
      img.onload = () => setImage(img);
      img.src = e.target.result as string;
    };
    reader.readAsDataURL(file);
  };

  const getPixelInfo = (imageData: Uint8ClampedArray, x: number, y: number, width: number): PixelInfo => {
    if (x < 0 || x >= width || y < 0 || y >= width) {
      return { r: 0, g: 0, b: 0, a: 0, feature: 'TERRAIN', rawHeight: 0 };
    }
    const index = (y * width + x) * 4;
    const r = imageData[index];
    const g = imageData[index + 1];
    const b = imageData[index + 2];
    const a = imageData[index + 3];
    const brightness = (r + g + b) / 3 / 255;
    const rawHeight = invertHeight ? 1 - brightness : brightness;

    // Helper function to calculate height (currently unused but kept for future use)
    // const getHeight = (x: number, y: number, width: number, data: Uint8ClampedArray): number => {
    //   const r = data[(y * width + x) * 4];
    //   const g = data[(y * width + x) * 4 + 1];
    //   const b = data[(y * width + x) * 4 + 2];
    //   const avg = (r + g + b) / 3;
    //   return (avg / 255) * (invertHeight ? -1 : 1) * heightScale + yPosition;
    // };

    if (removeText) {
      const saturation = Math.max(r, g, b) - Math.min(r, g, b);
      if (a < 200 || (r > 220 && g < 80 && b < 80) || (g > 200 && r < 150 && b < 150 && (g - r) > 50) || (saturation > 130 && brightness > 150) || (r < 30 && g < 30 && b < 30)) {
        return { r, g, b, a, feature: 'TERRAIN', rawHeight: 0.05 };
      }

      const isRoad = (r: number, g: number, b: number) => {
        if (r > 200 && g > 150 && b < 130) return true;
        if (r > 210 && g > 210 && b > 210 && Math.abs(r - g) < 20 && Math.abs(g - b) < 20) return true;
        return false;
      };

      if (isRoad(r, g, b)) {
        return { r, g, b, a, feature: 'ROAD', rawHeight };
      }

      const isBuilding = (r: number, g: number, b: number) => {
        const brightness = (r + g + b) / 3;
        const saturation = Math.max(r, g, b) - Math.min(r, g, b);
        if (brightness > 90 && brightness < 220 && saturation < 40) {
          return true;
        }
        return false;
      };

      if (isBuilding(r, g, b)) {
        return { r, g, b, a, feature: 'BUILDING', rawHeight };
      }
    }

    return { r, g, b, a, feature: 'TERRAIN', rawHeight };
  };

  // Add resize handler for the canvas
  useEffect(() => {
    const handleResize = () => {
      if (rendererRef.current && cameraRef.current) {
        const width = canvasRef.current?.clientWidth || window.innerWidth;
        const height = canvasRef.current?.clientHeight || window.innerHeight;
        
        cameraRef.current.aspect = width / height;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current?.setSize(width, height);
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();
    
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Main effect for 3D model generation
  useEffect(() => {
    if (!image || !(image.complete && image.naturalWidth !== 0) || !canvasRef.current) return;

    const processImage = (img: CanvasImageSource, width: number, height: number): HTMLCanvasElement | null => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      // Eliminar texto si es necesario
      if (removeText) {
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;

        // Umbral para detectar colores de texto (blanco/negro)
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          // Detectar píxeles de texto (blancos o negros puros)
          const isWhite = r > 230 && g > 230 && b > 230;
          const isBlack = r < 25 && g < 25 && b < 25;

          if (isWhite || isBlack) {
            // Reemplazar con el color del terreno circundante
            data[i] = 150;     // R
            data[i + 1] = 150; // G
            data[i + 2] = 150; // B
          }
        }

        ctx.putImageData(imageData, 0, 0);
      }

      return canvas;
    };

    const tempCanvas = processImage(image, segments, segments);
    if (!tempCanvas) return;

    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return;

    const imageData = tempCtx.getImageData(0, 0, segments, segments);

    // Pass 1: Generate raw height map and feature map
    const rawHeightMap: number[][] = [];
    const featureMap: FeatureType[][] = [];
    for (let i = 0; i < segments; i++) {
      rawHeightMap[i] = [];
      featureMap[i] = [];
      for (let j = 0; j < segments; j++) {
        const pixelInfo = getPixelInfo(imageData.data, j, i, segments);
        rawHeightMap[i][j] = pixelInfo.rawHeight;
        featureMap[i][j] = pixelInfo.feature;
      }
    }

    // Pass 2: Process maps to create final height map
    const finalHeightMap: number[][] = [];
    for (let i = 0; i < segments; i++) {
      finalHeightMap[i] = [];
      for (let j = 0; j < segments; j++) {
        const feature = featureMap[i][j];
        // rawHeight is used in the map, but we'll access it directly from rawHeightMap

        if (feature === 'ROAD') {
          finalHeightMap[i][j] = 0.05;
        } else if (feature === 'BUILDING') {
          let buildingNeighbors = 0;
          for (let ni = -1; ni <= 1; ni++) {
            for (let nj = -1; nj <= 1; nj++) {
              if (ni === 0 && nj === 0) continue;
              const ni_abs = i + ni;
              const nj_abs = j + nj;
              if (ni_abs >= 0 && ni_abs < segments && nj_abs >= 0 && nj_abs < segments && featureMap[ni_abs][nj_abs] === 'BUILDING') {
                buildingNeighbors++;
              }
            }
          }
          // Si hay suficientes vecinos edificio, es un edificio, si no, es terreno
          const currentRawHeight = rawHeightMap[i][j];
          if (buildingNeighbors >= 5) {
            finalHeightMap[i][j] = invertHeight ? 0.2 : 0.8;
          } else if (buildingNeighbors >= 3) {
            finalHeightMap[i][j] = invertHeight ? 0.4 : 0.6;
          } else {
            finalHeightMap[i][j] = 0.2 + currentRawHeight * 0.8; // Asegurar altura mínima
          }
        } else { // TERRAIN
          finalHeightMap[i][j] = rawHeightMap[i][j] * 0.2;
        }
      }
    }
    
    if (sceneRef.current && meshRef.current) {
      sceneRef.current.remove(meshRef.current);
      if (meshRef.current.geometry) meshRef.current.geometry.dispose();
      if (meshRef.current.material) {
        if (Array.isArray(meshRef.current.material)) {
          meshRef.current.material.forEach(mat => mat.dispose());
        } else {
          meshRef.current.material.dispose();
        }
      }
    }

    if (!sceneRef.current) {
      sceneRef.current = new THREE.Scene();
      sceneRef.current.background = new THREE.Color(0x1a1a2e);
    }

    if (!cameraRef.current) {
      cameraRef.current = new THREE.PerspectiveCamera(
        60,
        canvasRef.current.clientWidth / canvasRef.current.clientHeight,
        0.1,
        1000
      );
      cameraRef.current.position.set(150, 150, 150);
      cameraRef.current.lookAt(0, 0, 0);
    }

    if (!rendererRef.current) {
      rendererRef.current = new THREE.WebGLRenderer({
        canvas: canvasRef.current,
        antialias: true,
        alpha: true
      });
      rendererRef.current.setPixelRatio(window.devicePixelRatio);
      rendererRef.current.setSize(
        canvasRef.current.clientWidth,
        canvasRef.current.clientHeight
      );
    }

    if (!controlsRef.current) {
      controlsRef.current = new OrbitControls(cameraRef.current, rendererRef.current.domElement);
      controlsRef.current.enableDamping = true;
      controlsRef.current.dampingFactor = 0.1;
      // Enable zoom and pan but with limits
      controlsRef.current.enableZoom = true;
      controlsRef.current.zoomSpeed = 0.8;
      controlsRef.current.minDistance = 50;
      controlsRef.current.maxDistance = 500;
      controlsRef.current.enablePan = true;
      controlsRef.current.panSpeed = 0.5;
      // Enable rotation
      controlsRef.current.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN
      };
      // Limit vertical rotation
      controlsRef.current.minPolarAngle = 0; // radians
      controlsRef.current.maxPolarAngle = Math.PI / 2; // radians
    }

    const geometry = new THREE.PlaneGeometry(200, 200, segments - 1, segments - 1);
    const vertices = geometry.attributes.position.array;

    // Apply vertex smoothing based on the slider value
    if (vertexSmoothing > 0) {
      // Create a temporary array to store smoothed heights
      const smoothedHeights = new Array(segments).fill(0).map(() => new Array(segments).fill(0));
      
      // Apply a simple box blur for vertex smoothing
      const kernelSize = Math.ceil(vertexSmoothing * 5) * 2 + 1; // 1, 3, 5, 7, etc.
      const halfKernel = Math.floor(kernelSize / 2);
      
      for (let i = 0; i < segments; i++) {
        for (let j = 0; j < segments; j++) {
          let sum = 0;
          let count = 0;
          
          // Sample neighboring vertices
          for (let ki = -halfKernel; ki <= halfKernel; ki++) {
            for (let kj = -halfKernel; kj <= halfKernel; kj++) {
              const ni = Math.max(0, Math.min(segments - 1, i + ki));
              const nj = Math.max(0, Math.min(segments - 1, j + kj));
              sum += finalHeightMap[ni][nj];
              count++;
            }
          }
          
          // Calculate weighted average
          smoothedHeights[i][j] = sum / count;
        }
      }
      
      // Apply smoothed heights to vertices
      for (let i = 0; i < segments; i++) {
        for (let j = 0; j < segments; j++) {
          const index = (i * segments + j) * 3;
          // Blend between original and smoothed height based on vertexSmoothing
          const smoothedHeight = smoothedHeights[i][j] * vertexSmoothing + 
                               finalHeightMap[i][j] * (1 - vertexSmoothing);
          vertices[index + 2] = smoothedHeight * heightScale;
        }
      }
    } else {
      // No smoothing, use original heights
      for (let i = 0; i < segments; i++) {
        for (let j = 0; j < segments; j++) {
          const index = (i * segments + j) * 3;
          const height = finalHeightMap[i][j];
          vertices[index + 2] = height * heightScale;
        }
      }
    }

    geometry.computeVertexNormals();

    const texture = new THREE.CanvasTexture(tempCanvas);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    
    // Apply texture smoothing based on the slider value
    if (textureSmoothing > 0) {
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearMipMapLinearFilter;
      texture.anisotropy = rendererRef.current?.capabilities.getMaxAnisotropy() || 1;
    } else {
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
    }

    // Create a canvas for post-processing the texture
    const postProcessCanvas = document.createElement('canvas');
    const postProcessCtx = postProcessCanvas.getContext('2d');
    
    // Set canvas size to match texture
    postProcessCanvas.width = texture.image.width;
    postProcessCanvas.height = texture.image.height;
    
    // Apply brightness and contrast
    if (postProcessCtx) {
      // Draw original image
      postProcessCtx.drawImage(texture.image, 0, 0);
      
      // Apply brightness and contrast
      if (brightness !== 1 || contrast !== 1) {
        const imageData = postProcessCtx.getImageData(0, 0, postProcessCanvas.width, postProcessCanvas.height);
        const data = imageData.data;
        
        const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
        
        for (let i = 0; i < data.length; i += 4) {
          // Apply brightness
          data[i] = Math.min(255, Math.max(0, (data[i] - 128) * brightness + 128));
          data[i + 1] = Math.min(255, Math.max(0, (data[i + 1] - 128) * brightness + 128));
          data[i + 2] = Math.min(255, Math.max(0, (data[i + 2] - 128) * brightness + 128));
          
          // Apply contrast
          data[i] = Math.min(255, Math.max(0, factor * (data[i] - 128) + 128));
          data[i + 1] = Math.min(255, Math.max(0, factor * (data[i + 1] - 128) + 128));
          data[i + 2] = Math.min(255, Math.max(0, factor * (data[i + 2] - 128) + 128));
        }
        
        postProcessCtx.putImageData(imageData, 0, 0);
      }
      
      // Update texture with processed image
      texture.image = postProcessCanvas;
      texture.needsUpdate = true;
    }
    
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      wireframe: false,
      side: THREE.DoubleSide,
      flatShading: false,
      metalness: metalness,
      roughness: roughness,
      color: 0xffffff
    });

    const mesh = new THREE.Mesh(geometry, material);
    // Set initial rotation to make it lie flat on the XZ plane
    mesh.rotation.x = -Math.PI / 2;
    meshRef.current = mesh;
    sceneRef.current.add(mesh);

    if (!sceneRef.current.children.find(child => child.type === 'DirectionalLight')) {
      const light1 = new THREE.DirectionalLight(0xffffff, 1);
      light1.position.set(100, 100, 100);
      sceneRef.current.add(light1);

      const light2 = new THREE.DirectionalLight(0xffffff, 0.5);
      light2.position.set(-100, 100, -100);
      sceneRef.current.add(light2);

      const ambientLight = new THREE.AmbientLight(0x404040, 1);
      sceneRef.current.add(ambientLight);
    }

    if (!sceneRef.current.children.find(child => child.type === 'GridHelper')) {
      const gridHelper = new THREE.GridHelper(200, 20, 0x444444, 0x222222);
      gridHelper.position.y = -1;
      sceneRef.current.add(gridHelper);
    }

    const animate = () => {
      if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return;
      
      // Only update if we have a mesh
      if (meshRef.current) {
        // Apply base rotation to make it flat, then add tilt
        meshRef.current.rotation.set(
          -Math.PI / 2 + tiltX,  // Start with flat rotation, then add X tilt
          tiltZ * 0.5,           // Apply some Y rotation based on Z tilt for better control
          tiltZ                  // Apply Z tilt
        );
        
        // Apply material properties
        const material = meshRef.current.material as THREE.MeshStandardMaterial;
        material.metalness = metalness;
        material.roughness = roughness;
        material.needsUpdate = true;
      }
      
      // Always update controls if they exist
      if (controlsRef.current) {
        controlsRef.current.update();
      }
      
      rendererRef.current.render(sceneRef.current, cameraRef.current);
      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [image, segments, invertHeight, removeText, yPosition, textureSmoothing, vertexSmoothing, brightness, contrast, metalness, roughness, heightScale, tiltX, tiltZ]);

  useEffect(() => {
    if (meshRef.current) {
      meshRef.current.position.y = yPosition;
    }
  }, [yPosition]);

  // Limpiar al desmontar
  useEffect(() => {
    return () => {
      if (rendererRef.current) {
        rendererRef.current.dispose();
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  const handleReset = () => {
    setImage(null);
    setHeightScale(50);
    setSegments(1185);
    setInvertHeight(false);
    setRemoveText(true);
    setYPosition(0);

  };

  const exportToGLB = async () => {
    if (!meshRef.current) {
      console.error('No hay malla para exportar');
      return;
    }

    try {
      // Crear una escena temporal solo con el mesh
      const exportScene = new THREE.Scene();
      
      // Clonar el mesh original con su material
      const originalMesh = meshRef.current as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
      
      // Crear una copia de la geometría original
      const geometry = originalMesh.geometry.clone();
      
      // Crear un material estándar para la exportación
      const material = new THREE.MeshStandardMaterial({
        map: (originalMesh.material as THREE.MeshStandardMaterial).map,
        metalness: metalness,
        roughness: roughness,
        side: THREE.DoubleSide
      });
      
      // Crear el mesh para exportar
      const mesh = new THREE.Mesh(geometry, material);
      
      // Aplicar la rotación correcta
      mesh.rotation.x = -Math.PI / 2; // Make it lie flat
      mesh.rotation.y = 0;
      mesh.rotation.z = 0;
      
      // Asegurarse de que las normales estén calculadas correctamente
      if (geometry.attributes.normal === undefined) {
        geometry.computeVertexNormals();
      }
      
      // Añadir a la escena
      exportScene.add(mesh);
      
      // Añadir luces básicas para mejor visualización
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
      exportScene.add(ambientLight);
      
      const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
      directionalLight.position.set(1, 1, 1);
      exportScene.add(directionalLight);
      
      // Configurar el exportador
      const exporter = new GLTFExporter();
      
      // Exportar el modelo
      const glb = await new Promise((resolve, reject) => {
        exporter.parse(
          exportScene,
          resolve,
          reject,
          {
            binary: true,
            onlyVisible: true,
            truncateDrawRange: true,
            maxTextureSize: 1024,
            embedImages: true,
            animations: []
          }
        );
      });
      
      // Crear un blob y descargar
      const blob = new Blob([glb as ArrayBuffer], { type: 'model/gltf-binary' });
      const url = URL.createObjectURL(blob);
      
      // Crear un enlace de descarga con un nombre de archivo único
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `terrain_model_${timestamp}.glb`;
      
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      
      // Limpieza
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 100);
      
    } catch (error) {
      console.error('Error durante la exportación:', error);
      alert('Error al exportar el modelo: ' + (error as Error).message);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4 overflow-hidden">
      <div className="max-w-7xl mx-auto h-[calc(100vh-2rem)] flex flex-col">
        <div className="text-center mb-2">
          <h1 className="text-3xl font-bold text-white mb-1">
            Visor 3D de Mapas
          </h1>
          <p className="text-purple-200 text-sm">
            Convierte imágenes de mapas en modelos 3D interactivos
          </p>
        </div>

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-4 h-[calc(100vh-8rem)]">
          {/* Panel de controles */}
          <div className="bg-white/10 backdrop-blur-lg rounded-xl border border-white/20 flex flex-col h-full overflow-hidden">
            <div className="p-4 border-b border-white/10 flex-shrink-0">
              <h2 className="text-lg font-semibold text-white mb-3">Configuración</h2>
              
              {/* Vista previa de la imagen */}
              <div className="bg-black/30 rounded-lg p-2 border border-white/10">
              {!image ? (
                <label className="flex flex-col items-center justify-center h-24 border-2 border-dashed border-purple-400 rounded-lg cursor-pointer hover:bg-white/5 transition-colors">
                  <Upload className="w-6 h-6 text-purple-400 mb-1" />
                  <span className="text-purple-200 text-xs">Cargar imagen de mapa</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                </label>
              ) : (
                <div className="space-y-1">
                  <div className="relative w-full h-20 overflow-hidden rounded-md border border-white/10">
                    <img
                      src={image.src}
                      alt="Vista previa del mapa"
                      className="w-full h-full object-contain bg-black/50"
                    />
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={handleReset}
                      className="flex-1 bg-red-500/20 hover:bg-red-500/30 text-red-200 py-1 px-2 rounded text-xs flex items-center justify-center gap-1"
                    >
                      <RotateCcw size={12} />
                      Resetear
                    </button>
                    <button
                      onClick={exportToGLB}
                      className="flex-1 bg-green-500/20 hover:bg-green-500/30 text-green-200 py-1 px-2 rounded text-xs flex items-center justify-center gap-1"
                    >
                      <Download size={12} />
                      Exportar
                    </button>
                  </div>
                </div>
              )}
            </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 pt-0">
              <div className="space-y-4 pb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-200 mb-1">Resolution: {segments} segments</label>
                  <input
                    type="range"
                    min="100"
                    max="2370"
                    step="10"
                    value={segments}
                    onChange={(e) => setSegments(Number(e.target.value))}
                    className="w-full accent-purple-500"
                  />
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>Low</span>
                    <span>Medium</span>
                    <span>High</span>
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-200 mb-1">Height Scale: {heightScale}%</label>
                  <input
                    type="range"
                    min="1"
                    max="100"
                    value={heightScale}
                    onChange={(e) => setHeightScale(Number(e.target.value))}
                    className="w-full accent-purple-500"
                  />
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>Low</span>
                    <span>Medium</span>
                    <span>High</span>
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-200 mb-1">Texture Smoothing: {textureSmoothing.toFixed(1)}</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={textureSmoothing}
                    onChange={(e) => setTextureSmoothing(Number(e.target.value))}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>Sharp</span>
                    <span>Smooth</span>
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-200 mb-1">Terrain Smoothing: {vertexSmoothing.toFixed(1)}</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={vertexSmoothing}
                    onChange={(e) => setVertexSmoothing(Number(e.target.value))}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>Sharp</span>
                    <span>Smooth</span>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-200 mb-1">Brightness: {brightness.toFixed(1)}</label>
                  <input
                    type="range"
                    min="0.5"
                    max="2"
                    step="0.1"
                    value={brightness}
                    onChange={(e) => setBrightness(Number(e.target.value))}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>Dark</span>
                    <span>Bright</span>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-200 mb-1">Contrast: {contrast.toFixed(1)}</label>
                  <input
                    type="range"
                    min="0.5"
                    max="2"
                    step="0.1"
                    value={contrast}
                    onChange={(e) => setContrast(Number(e.target.value))}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>Low</span>
                    <span>High</span>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-200 mb-1">Metalness: {metalness.toFixed(1)}</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={metalness}
                    onChange={(e) => setMetalness(parseFloat(e.target.value))}
                    className="w-full accent-purple-500"
                  />
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>Matte</span>
                    <span>Intermedio</span>
                    <span>Metálico</span>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-200 mb-1">Roughness: {roughness.toFixed(1)}</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={roughness}
                    onChange={(e) => setRoughness(parseFloat(e.target.value))}
                    className="w-full accent-purple-500"
                  />
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>Suave</span>
                    <span>Intermedio</span>
                    <span>Áspero</span>
                  </div>
                </div>

                <div className="pt-2 border-t border-white/10">
                  <h3 className="text-sm font-medium text-purple-300 mb-3">Opciones Adicionales</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-200 mb-1">Posición Y: {yPosition.toFixed(1)}</label>
                      <input
                        type="range"
                        min="-50"
                        max="50"
                        step="1"
                        value={yPosition}
                        onChange={(e) => setYPosition(Number(e.target.value))}
                        className="w-full"
                      />
                      <div className="flex justify-between text-xs text-gray-400">
                        <span>Abajo</span>
                        <span>Centro</span>
                        <span>Arriba</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <label className="flex items-center text-sm text-gray-200">
                        <input
                          type="checkbox"
                          checked={invertHeight}
                          onChange={(e) => setInvertHeight(e.target.checked)}
                          className="mr-2 h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                        />
                        Invertir Altura
                      </label>
                      <label className="flex items-center text-sm text-gray-200">
                        <input
                          type="checkbox"
                          checked={removeText}
                          onChange={(e) => setRemoveText(e.target.checked)}
                          className="mr-2 h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                        />
                        Quitar Texto
                      </label>
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-white/10">
                  <h3 className="text-sm font-medium text-purple-300 mb-3">Inclinación del Modelo</h3>
                  <div className="space-y-4 mb-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-200 mb-1">Inclinación Frontal: {(tiltX * 180 / Math.PI).toFixed(0)}°</label>
                      <input
                        type="range"
                        min="-45"
                        max="45"
                        step="1"
                        value={tiltX * 180 / Math.PI}
                        onChange={(e) => setTiltX(Number(e.target.value) * Math.PI / 180)}
                        className="w-full accent-purple-500"
                      />
                      <div className="flex justify-between text-xs text-gray-400">
                        <span>Hacia atrás</span>
                        <span>Recto</span>
                        <span>Hacia adelante</span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-200 mb-1">Inclinación Lateral: {(tiltZ * 180 / Math.PI).toFixed(0)}°</label>
                      <input
                        type="range"
                        min="-45"
                        max="45"
                        step="1"
                        value={tiltZ * 180 / Math.PI}
                        onChange={(e) => setTiltZ(Number(e.target.value) * Math.PI / 180)}
                        className="w-full accent-purple-500"
                      />
                      <div className="flex justify-between text-xs text-gray-400">
                        <span>Izquierda</span>
                        <span>Centro</span>
                        <span>Derecha</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-white/10">
                  <div className="flex justify-between items-center">
                    <h3 className="text-sm font-medium text-purple-300">Opciones</h3>
                    <div className="flex items-center space-x-2">
                      <label className="flex items-center text-xs text-gray-300">
                        <input
                          type="checkbox"
                          checked={invertHeight}
                          onChange={(e) => setInvertHeight(e.target.checked)}
                          className="mr-1 h-3 w-3 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                        />
                        Invertir altura
                      </label>
                      <label className="flex items-center text-xs text-gray-300">
                        <input
                          type="checkbox"
                          checked={removeText}
                          onChange={(e) => setRemoveText(e.target.checked)}
                          className="mr-1 h-3 w-3 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                        />
                        Quitar texto
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Vista previa 3D */}
          <div className="lg:col-span-3 bg-black/50 rounded-xl overflow-hidden border border-white/20 relative">
            <canvas
              ref={canvasRef}
              className="w-full h-full block"
              style={{ backgroundColor: '#0f172a' }}
            />
            {!image && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm">
                <div className="text-center p-4 max-w-md">
                  <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-purple-500/20 flex items-center justify-center">
                    <Upload className="w-6 h-6 text-purple-300" />
                  </div>
                  <h3 className="text-white text-base font-medium mb-1">Sin mapa cargado</h3>
                  <p className="text-purple-200 text-xs">Carga una imagen en el panel de la izquierda</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}