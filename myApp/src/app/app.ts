import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BarcodeScanner, LensFacing } from '@capacitor-mlkit/barcode-scanning';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class AppComponent implements OnInit {

  ipAddress: string = '';
  isIpSet: boolean = false;
  scanResult: string = '';

  ngOnInit() {
    // Check if IP was already saved previously
    const savedIp = localStorage.getItem('serverIp');
    if (savedIp) {
      this.ipAddress = savedIp;
      this.isIpSet = true;
    }
  }

  setIp() {
    if (this.ipAddress.trim() !== '') {
      localStorage.setItem('serverIp', this.ipAddress);
      this.isIpSet = true;
    } else {
      alert('Please enter IP Address');
    }
  }

  async scanQR() {
    try {
      // 1. Permissions
      const permission = await BarcodeScanner.requestPermissions();
      if (permission.camera !== 'granted') {
        alert('Camera permission denied');
        return;
      }

      // 2. The critical check for "Other" phones
      const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
      
      if (!available) {
        alert('Scanner module missing. Downloading now... please wait 10 seconds and try again.');
        await BarcodeScanner.installGoogleBarcodeScannerModule();
        return; // Stop here so the user can try again after the download
      }

      // 3. Simple scan call (Fixed the Error)
      const result = await BarcodeScanner.scan();

      if (result.barcodes.length > 0) {
        this.scanResult = result.barcodes[0].rawValue!;
      }
    } catch (error) {
      console.error('Scan Error:', error);
      alert('Scanning failed. Make sure Google Play Services is updated.');
    }
  }
  resetIp() {
    localStorage.removeItem('serverIp');
    this.isIpSet = false;
    this.ipAddress = '';
    this.scanResult = '';
  }
}